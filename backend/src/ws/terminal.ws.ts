import type { IncomingMessage, Server } from "http";
import WebSocket, { WebSocketServer } from "ws";
import { getSession, refreshSession } from "../services/docker.service.js";
import * as pty from "node-pty";
import type { WsMessage } from "../types/index.d.ts";

// ─────────────────────────────────────────────────────────────────────────────
// RO_EXEC terminal guard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Commands (and shell constructs) that mutate the filesystem.
 *
 * Each entry is tested as a whole token at the start of a pipeline stage,
 * so "touch" blocks "touch foo" but not "cat something | touch" (which we
 * also catch because "touch" appears as a stage-start token after "|").
 *
 * Redirect operators (> and >>) are caught separately via regex.
 */
const FS_MUTATING_CMDS = new Set([
    // creation / directory
    "touch", "mkdir", "mkfifo", "mknod", "install",
    // deletion
    "rm", "rmdir", "unlink", "shred", "wipe",
    // copy / move / rename
    "cp", "mv", "rsync", "rename",
    // permission / ownership
    "chmod", "chown", "chgrp",
    // low-level write
    "dd", "tee", "truncate",
    // link
    "ln",
    // python / node one-liners that open files for writing are harder to
    // catch syntactically, so we leave them to the :ro bind-mount kernel guard
]);

/**
 * Check a single assembled command-line for FS-mutating operations.
 * Returns a human-readable reason string, or null if the line is safe.
 */
function isFsMutating(line: string): string | null {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return null;          // blank / comment

    // Output redirection:  cmd > file  or  cmd >> file
    // (must come before token split to catch:  echo hi > foo)
    if (/(?:^|[^<>])>{1,2}(?!>)/.test(trimmed)) {
        return "output redirection (> / >>) is not permitted";
    }

    // Split on pipes, semicolons, &&, || — then inspect first token of each stage
    const stages = trimmed.split(/[|;&]|\s*&&\s*|\s*\|\|\s*/);
    for (const stage of stages) {
        const firstToken = stage.trim().split(/\s+/)[0]?.toLowerCase();
        if (firstToken && FS_MUTATING_CMDS.has(firstToken)) {
            return `\`${firstToken}\` is not permitted in Read-Only labs`;
        }
    }

    return null;
}

// ANSI helpers
const RED    = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET  = "\x1b[0m";
const BELL   = "\x07";

function buildErrorBanner(reason: string): string {
    return (
        `\r\n${RED}[RO_EXEC] Blocked: ${reason}.${RESET}\r\n` +
        `${YELLOW}Hint: This is a Read-Only lab — filesystem modifications are not allowed.${RESET}\r\n`
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket server
// ─────────────────────────────────────────────────────────────────────────────

const initTerminalWS = (httpServer: Server): void => {
    const wss = new WebSocketServer({
        server: httpServer,
        path: "/ws"
    });

    wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
        const rawUrl = req.url ?? "";
        const sessionId = new URL(rawUrl, "http://localhost").searchParams.get("session");

        if (!sessionId) {
            ws.close(1008, "Missing session query param");
            return;
        }

        const session = await getSession(sessionId);
        if (!session) {
            ws.close(1008, "Session not found or expired");
            return;
        }

        const isRoExec = session.labType === "RO_EXEC";
        console.log(`[WS] Terminal connected session=${sessionId} labType=${session.labType}`);

        // Spawn docker exec bash PTY
        let ptyProc: pty.IPty;
        try {
            ptyProc = pty.spawn("docker", ["exec", "-it", session.containerId, "bash"], {
                name: "xterm-256color",
                cols: 120,
                rows: 40,
                cwd: process.cwd(),
                env: process.env as Record<string, string>,
            });
        } catch (error) {
            console.error("[WS] PTY spawn failed:", error);
            ws.close(1011, "Failed to spawn terminal");
            return;
        }

        // ── PTY → browser ────────────────────────────────────────────────────
        ptyProc.onData((data: string) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(data);
        });

        ptyProc.onExit(({ exitCode }) => {
            console.log(`[WS] PTY exited session=${sessionId} code=${exitCode}`);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send("\r\n\x1b[31m[Terminal closed]\x1b[0m\r\n");
                ws.close(1000, "Terminal exited");
            }
        });

        // ── Per-connection line buffer (RO_EXEC only) ─────────────────────────
        // We accumulate typed characters into `lineBuffer`.  When the user
        // presses Enter (\r or \n) we scan the buffer; if it matches a
        // blocked pattern we:
        //   1. Send a red error banner back to the browser terminal
        //   2. Discard the Enter — the shell never receives the command
        //   3. Clear the buffer
        // If the line is safe we flush the buffer + Enter to the PTY normally.
        let lineBuffer = "";

        function handleInput(data: string): void {
            if (!isRoExec) {
                // RWX — pass everything straight through
                ptyProc.write(data);
                return;
            }

            for (const ch of data) {
                const code = ch.charCodeAt(0);

                // Ctrl+C / Ctrl+D / Ctrl+Z — pass through immediately & clear buffer
                if (code === 0x03 || code === 0x04 || code === 0x1a) {
                    lineBuffer = "";
                    ptyProc.write(ch);
                    return;
                }

                // Backspace / DEL — trim buffer
                if (code === 0x7f || code === 0x08) {
                    if (lineBuffer.length > 0) lineBuffer = lineBuffer.slice(0, -1);
                    ptyProc.write(ch);   // let the terminal echo the erase
                    continue;
                }

                // ESC sequences (arrow keys, function keys, etc.) — pass through,
                // they don't contribute printable chars to the command
                if (code === 0x1b) {
                    ptyProc.write(data);   // forward entire chunk & stop per-char loop
                    return;
                }

                // Enter key (CR or LF)
                if (ch === "\r" || ch === "\n") {
                    const reason = isFsMutating(lineBuffer);
                    if (reason) {
                        console.warn(
                            `[WS][RO_EXEC] Blocked command="${lineBuffer.trim()}" ` +
                            `session=${sessionId} reason=${reason}`
                        );
                        // ── CRITICAL: do NOT write \r to the PTY ──────────────
                        // \r in bash readline means "execute".  If we send it,
                        // the command runs before \x03 can cancel anything.
                        //
                        // Instead:
                        //  1. Ctrl+U (\x15) — kills bash readline buffer silently,
                        //     no "^C" noise, no new prompt line from the PTY.
                        //  2. We move the browser cursor ourselves via ws.send so
                        //     the user sees the error below their typed line.
                        ptyProc.write("\x15");             // wipe readline buffer
                        ws.send("\r\n" + buildErrorBanner(reason) + BELL);
                    } else {
                        // Safe — forward Enter to PTY normally
                        ptyProc.write(ch);
                    }
                    lineBuffer = "";
                    continue;
                }

                // Regular printable character
                lineBuffer += ch;
                ptyProc.write(ch);
            }
        }

        // ── browser → PTY ─────────────────────────────────────────────────────
        ws.on("message", async (raw: Buffer | string) => {
            try {
                const msg: WsMessage = JSON.parse(raw.toString());

                if (msg.type === "resize") {
                    ptyProc.resize(
                        Math.max(1, msg.cols),
                        Math.max(1, msg.rows)
                    );
                } else if (msg.type === "input") {
                    handleInput(msg.data);
                    await refreshSession(sessionId);
                }
            } catch {
                // Raw (non-JSON) fallback
                handleInput(raw.toString());
                await refreshSession(sessionId);
            }
        });

        ws.on("close", () => {
            console.log(`[WS] Disconnected session=${sessionId}`);
            try { ptyProc.kill(); } catch { /* ignore */ }
        });

        ws.on("error", (err) => {
            console.error("[WS] Socket error:", err);
            try { ptyProc.kill(); } catch { /* ignore */ }
        });
    });

    console.log("[WS] Terminal WebSocket server attached");
};

export default initTerminalWS;
import type { IncomingMessage, Server } from "http";
import WebSocket, { WebSocketServer } from "ws";
import { getSession, refreshSession } from "../services/docker.service.js";
import * as pty from "node-pty";
import { posix as posixPath } from "path";
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
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";
const BELL = "\x07";

function buildErrorBanner(reason: string): string {
    return (
        `\r\n${RED}[RO_EXEC] Blocked: ${reason}.${RESET}\r\n` +
        `${YELLOW}Hint: This is a Read-Only lab — filesystem modifications are not allowed.${RESET}\r\n`
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Workspace confinement
// ─────────────────────────────────────────────────────────────────────────────

const WORKSPACE_ROOT = "/workspace";
const CONTAINER_HOME = "/root";   // default $HOME for root inside Docker

/**
 * If `line` is a plain `cd` command, returns the argument string
 * (empty string for a bare `cd` with no args).
 * Returns null if the line is not a cd command.
 */
function parseCdArg(line: string): string | null {
    // Matches: cd, cd <arg>  — but NOT cdx or cd-something
    const m = line.match(/^\s*cd(?:\s+(.*))?$/);
    if (!m) return null;
    return (m[1] ?? "").trim();
}

/**
 * Resolve what the new CWD would become after `cd <arg>` from `current`.
 * Handles absolute paths, relative paths, bare `cd`, and `cd ~`.
 */
function resolveNewCwd(current: string, arg: string): string {
    if (!arg || arg === "~") return CONTAINER_HOME;
    if (arg.startsWith("~/")) {
        return posixPath.normalize(CONTAINER_HOME + "/" + arg.slice(2));
    }
    if (arg.startsWith("/")) {
        return posixPath.normalize(arg);
    }
    return posixPath.normalize(posixPath.join(current, arg));
}

/** Returns true when `p` is /workspace itself or a descendant. */
function isInsideWorkspace(p: string): boolean {
    const n = posixPath.normalize(p);
    return n === WORKSPACE_ROOT || n.startsWith(WORKSPACE_ROOT + "/");
}

function buildCdBlockedBanner(resolved: string): string {
    return (
        `\r\n${RED}[SANDBOX] Blocked: \"${resolved}\" is outside /workspace.${RESET}\r\n` +
        `${YELLOW}You are confined to /workspace and its subdirectories.${RESET}\r\n`
    );
}

function buildCwdErrorBanner(cwd: string): string {
    return (
        `\r\n${RED}[SANDBOX] Error: current directory \"${cwd}\" is outside /workspace.${RESET}\r\n` +
        `${YELLOW}Returning to /workspace…${RESET}\r\n`
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
            ptyProc = pty.spawn("docker", [
                "exec", "-it",
                "--workdir", WORKSPACE_ROOT,   // always start inside /workspace
                session.containerId, "bash"
            ], {
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

        // ── Per-connection line buffer ─────────────────────────────────────────
        // All input (both RWX and RO_EXEC) is buffered character-by-character.
        // On Enter we inspect the assembled line before forwarding it to the PTY:
        //
        //   1. Workspace confinement  — cd commands are resolved and blocked if
        //      they would escape /workspace; any other command is blocked when
        //      the tracked CWD is already outside /workspace.
        //   2. RO_EXEC FS-mutation check — applied on top of confinement.
        //
        // Non-printable control sequences (ESC, Ctrl-C, etc.) are forwarded
        // immediately as before.
        let lineBuffer = "";
        let trackedCwd = WORKSPACE_ROOT;   // server-side CWD mirror
        let previousCwd = WORKSPACE_ROOT;   // for `cd -`

        function handleInput(data: string): void {
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

                // ── Enter key (CR or LF) ────────────────────────────────────────
                if (ch === "\r" || ch === "\n") {
                    const line = lineBuffer.trim();
                    lineBuffer = "";

                    // ── 1. Workspace confinement: cd ────────────────────────────
                    // Intercept `cd` before anything else so the user can always
                    // type `cd /workspace` to recover even if CWD drifted outside.
                    const cdArg = parseCdArg(line);
                    if (cdArg !== null) {
                        const newCwd = cdArg === "-"
                            ? previousCwd
                            : resolveNewCwd(trackedCwd, cdArg);

                        if (!isInsideWorkspace(newCwd)) {
                            console.warn(
                                `[WS][SANDBOX] Blocked cd target="${newCwd}" ` +
                                `session=${sessionId}`
                            );
                            ptyProc.write("\x15");   // wipe readline buffer
                            ws.send("\r\n" + buildCdBlockedBanner(newCwd) + BELL);
                            continue;   // do NOT execute the cd
                        }

                        // Safe cd — update tracking and execute
                        previousCwd = trackedCwd;
                        trackedCwd = newCwd;
                        ptyProc.write(ch);
                        continue;
                    }

                    // ── 2. Workspace confinement: non-cd commands ───────────────
                    // If the tracked CWD is somehow outside /workspace (e.g. a
                    // script changed it under us), block all commands and force
                    // the shell back.
                    if (!isInsideWorkspace(trackedCwd)) {
                        console.warn(
                            `[WS][SANDBOX] Blocked cmd outside workspace ` +
                            `cwd="${trackedCwd}" cmd="${line}" session=${sessionId}`
                        );
                        ptyProc.write("\x15");
                        ws.send("\r\n" + buildCwdErrorBanner(trackedCwd) + BELL);
                        // Force the shell back into /workspace
                        ptyProc.write(`cd ${WORKSPACE_ROOT}\r`);
                        previousCwd = trackedCwd;
                        trackedCwd = WORKSPACE_ROOT;
                        continue;
                    }

                    // ── 3. RO_EXEC FS-mutation check ────────────────────────────
                    if (isRoExec) {
                        const reason = isFsMutating(line);
                        if (reason) {
                            console.warn(
                                `[WS][RO_EXEC] Blocked command="${line}" ` +
                                `session=${sessionId} reason=${reason}`
                            );
                            ptyProc.write("\x15");   // wipe readline buffer
                            ws.send("\r\n" + buildErrorBanner(reason) + BELL);
                            continue;
                        }
                    }

                    // Safe — forward Enter to PTY normally
                    ptyProc.write(ch);
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
import type { IncomingMessage, Server } from "http";
import WebSocket, { WebSocketServer } from "ws";
import { getSession, refreshSession, docker } from "../services/docker.service.js";
import * as pty from "node-pty";
import { posix as posixPath } from "path";
import type { WsMessage } from "../types/index.d.ts";
import { PassThrough } from "stream";

// ─────────────────────────────────────────────────────────────────────────────
// Workspace confinement (RWX only)
// ─────────────────────────────────────────────────────────────────────────────

const WORKSPACE_ROOT = "/workspace";
const CONTAINER_HOME = "/root";   // default $HOME for root inside Docker

// ANSI helpers
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";
const BELL = "\x07";

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

        console.log(`[WS] Connected session=${sessionId} labType=${session.labType}`);

        // ── PTY Setup (RWX only) ──────────────────────────────────────────────
        let ptyProc: pty.IPty | null = null;
        
        if (session.labType !== "RO_EXEC") {
            try {
                ptyProc = pty.spawn("docker", [
                    "exec", "-it",
                    "--workdir", WORKSPACE_ROOT,
                    session.containerId, "bash"
                ], {
                    name: "xterm-256color",
                    cols: 120,
                    rows: 40,
                    cwd: process.cwd(),
                    env: process.env as Record<string, string>,
                });

                ptyProc.onData((data: string) => {
                    if (ws.readyState === WebSocket.OPEN) ws.send(data);
                });

                ptyProc.onExit(({ exitCode }) => {
                    console.log(`[WS] PTY exited session=${sessionId} code=${exitCode}`);
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send("\r\n\x1b[31m[Terminal closed]\x1b[0m\r\n");
                    }
                    ptyProc = null;
                });
            } catch (error) {
                console.error("[WS] PTY spawn failed:", error);
            }
        }

        // ── Per-connection line buffer (PTY only) ─────────────────────────────
        let lineBuffer = "";
        let trackedCwd = WORKSPACE_ROOT;
        let previousCwd = WORKSPACE_ROOT;

        function handleInput(data: string): void {
            if (!ptyProc) return;
            for (const ch of data) {
                const code = ch.charCodeAt(0);

                if (code === 0x03 || code === 0x04 || code === 0x1a) {
                    lineBuffer = "";
                    ptyProc.write(ch);
                    return;
                }

                if (code === 0x7f || code === 0x08) {
                    if (lineBuffer.length > 0) lineBuffer = lineBuffer.slice(0, -1);
                    ptyProc.write(ch);
                    continue;
                }

                if (code === 0x1b) {
                    ptyProc.write(data);
                    return;
                }

                if (ch === "\r" || ch === "\n") {
                    const line = lineBuffer.trim();
                    lineBuffer = "";

                    const cdArg = parseCdArg(line);
                    if (cdArg !== null) {
                        const newCwd = cdArg === "-"
                            ? previousCwd
                            : resolveNewCwd(trackedCwd, cdArg);

                        if (!isInsideWorkspace(newCwd)) {
                            console.warn(`[WS][SANDBOX] Blocked cd target="${newCwd}" session=${sessionId}`);
                            ptyProc.write("\x15");
                            ws.send("\r\n" + buildCdBlockedBanner(newCwd) + BELL);
                            continue;
                        }

                        previousCwd = trackedCwd;
                        trackedCwd = newCwd;
                        ptyProc.write(ch);
                        continue;
                    }

                    if (!isInsideWorkspace(trackedCwd)) {
                        console.warn(`[WS][SANDBOX] Blocked cmd outside workspace cwd="${trackedCwd}" cmd="${line}" session=${sessionId}`);
                        ptyProc.write("\x15");
                        ws.send("\r\n" + buildCwdErrorBanner(trackedCwd) + BELL);
                        ptyProc.write(`cd ${WORKSPACE_ROOT}\r`);
                        previousCwd = trackedCwd;
                        trackedCwd = WORKSPACE_ROOT;
                        continue;
                    }

                    ptyProc.write(ch);
                    continue;
                }

                lineBuffer += ch;
                ptyProc.write(ch);
            }
        }

        // ── Run stream state ──────────────────────────────────────────────────
        let currentExecStream: any = null;
        let currentExecTimeout: NodeJS.Timeout | null = null;
        
        async function killDockerExec() {
            if (!session) return;
            try {
                const container = docker.getContainer(session.containerId);
                const killExec = await container.exec({
                    Cmd: ["pkill", "-f", "python /workspace/main.py"]
                });
                await killExec.start({});
            } catch (e) {
                // Ignore kill errors
            }
        }

        // ── browser → PTY/Run ─────────────────────────────────────────────────
        ws.on("message", async (raw: Buffer | string) => {
            try {
                const msg: WsMessage = JSON.parse(raw.toString());

                if (msg.type === "resize") {
                    if (ptyProc) {
                        ptyProc.resize(
                            Math.max(1, msg.cols),
                            Math.max(1, msg.rows)
                        );
                    }
                } else if (msg.type === "input") {
                    if (ptyProc) {
                        handleInput(msg.data);
                    }
                    await refreshSession(sessionId);
                } else if (msg.type === "run") {
                    if (currentExecStream) {
                        ws.send(JSON.stringify({ type: "run_error", message: "Already running" }));
                        return;
                    }
                    try {
                        const container = docker.getContainer(session.containerId);
                        const exec = await container.exec({
                            Cmd: ["python", "-u", "/workspace/main.py"], // -u for unbuffered output
                            AttachStdout: true,
                            AttachStderr: true,
                            Tty: false,
                        });
                        const stream = await exec.start({ hijack: true, stdin: false });
                        currentExecStream = stream;

                        const stdout = new PassThrough();
                        const stderr = new PassThrough();
                        docker.modem.demuxStream(stream, stdout, stderr);

                        stdout.on("data", (chunk: Buffer) => {
                            if (ws.readyState === WebSocket.OPEN) {
                                ws.send(JSON.stringify({ type: "output", data: chunk.toString() }));
                            }
                        });
                        stderr.on("data", (chunk: Buffer) => {
                            if (ws.readyState === WebSocket.OPEN) {
                                ws.send(JSON.stringify({ type: "output", data: `[stderr] ${chunk.toString()}` }));
                            }
                        });

                        stream.on("end", async () => {
                            currentExecStream = null;
                            if (currentExecTimeout) clearTimeout(currentExecTimeout);
                            try {
                                const inspect = await exec.inspect();
                                if (ws.readyState === WebSocket.OPEN) {
                                    ws.send(JSON.stringify({ type: "exit", code: inspect.ExitCode }));
                                }
                            } catch(e) {}
                        });

                        currentExecTimeout = setTimeout(async () => {
                            if (currentExecStream) {
                                if (ws.readyState === WebSocket.OPEN) {
                                    ws.send(JSON.stringify({ type: "output", data: "\n[Terminated: 30s timeout]\n" }));
                                }
                                currentExecStream.destroy();
                                currentExecStream = null;
                                if (ws.readyState === WebSocket.OPEN) {
                                    ws.send(JSON.stringify({ type: "exit", code: -1 }));
                                }
                                await killDockerExec();
                            }
                        }, 30_000);

                    } catch (err: any) {
                        ws.send(JSON.stringify({ type: "run_error", message: err.message }));
                    }
                    await refreshSession(sessionId);
                } else if (msg.type === "kill") {
                    if (currentExecStream) {
                        currentExecStream.destroy();
                        currentExecStream = null;
                        if (currentExecTimeout) clearTimeout(currentExecTimeout);
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ type: "output", data: "\n[Terminated by user]\n" }));
                            ws.send(JSON.stringify({ type: "exit", code: -1 }));
                        }
                        await killDockerExec();
                    }
                }
            } catch {
                // Raw (non-JSON) fallback
                if (ptyProc) {
                    handleInput(raw.toString());
                }
                await refreshSession(sessionId);
            }
        });

        ws.on("close", () => {
            console.log(`[WS] Disconnected session=${sessionId}`);
            try { if (ptyProc) ptyProc.kill(); } catch { /* ignore */ }
            try { if (currentExecStream) currentExecStream.destroy(); } catch { /* ignore */ }
            if (currentExecTimeout) clearTimeout(currentExecTimeout);
        });

        ws.on("error", (err) => {
            console.error("[WS] Socket error:", err);
            try { if (ptyProc) ptyProc.kill(); } catch { /* ignore */ }
            try { if (currentExecStream) currentExecStream.destroy(); } catch { /* ignore */ }
            if (currentExecTimeout) clearTimeout(currentExecTimeout);
        });
    });

    console.log("[WS] Terminal WebSocket server attached");
};

export default initTerminalWS;
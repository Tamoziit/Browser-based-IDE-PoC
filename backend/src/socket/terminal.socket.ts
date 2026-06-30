import type { Server as HttpServer } from "http";
import initSocketServer from "./socket";
import { getSession } from "../services/k8s.service";
import type { TerminalState } from "../types";
import { PassThrough } from "stream";
import {
    handleDisconnect,
    handleInput,
    handleKill,
    handleResize,
    handleRun,
    initTerminalExec,
} from "../controllers/terminal.controller";

const initTerminalSocket = (httpServer: HttpServer): void => {
    const io = initSocketServer(httpServer);

    io.on("connection", async (socket) => {
        const userId = socket.handshake.query.userId as string | undefined;
        console.log(`[WS] Client connected userId=${userId}`);

        // Each socket gets its own terminal state once it joins a session
        let terminalState: TerminalState | null = null;
        let activeSessionId: string | null = null;

        // ── join-session ──────────────────────────────────────────────────────
        // Emitted by the frontend after startLab returns a sessionId.
        // Sets up the PTY exec for this socket's terminal.
        socket.on("join-session", async ({ sessionId }: { sessionId: string }) => {
            if (!sessionId) {
                socket.emit("error", "sessionId is required");
                return;
            }

            // Prevent re-joining the same session
            if (activeSessionId === sessionId) return;

            const session = await getSession(sessionId);
            if (!session) {
                socket.emit("error", "Session not found or expired");
                return;
            }

            console.log(`[WS] Joined session=${sessionId} pod=${session.podName}`);
            activeSessionId = sessionId;

            terminalState = {
                session,
                stdinStream: new PassThrough(),
                stdoutStream: new PassThrough(),
                execWebSocket: null,
                runExecWs: null,
                runTimeout: null,
                lineBuffer: "",
                trackedCwd: session.workspacePath,
                previousCwd: session.workspacePath,
            };

            await initTerminalExec(socket, terminalState);
        });

        // ── Terminal input ────────────────────────────────────────────────────
        socket.on("input", ({ data }: { data: string }) => {
            if (!terminalState || !activeSessionId) return;
            handleInput(data, socket, terminalState, activeSessionId);
        });

        // ── Terminal resize ───────────────────────────────────────────────────
        socket.on("resize", ({ cols, rows }: { cols: number; rows: number }) => {
            if (!terminalState) return;
            handleResize(cols, rows, terminalState);
        });

        // ── Run code ─────────────────────────────────────────────────────────
        socket.on("run", () => {
            if (!terminalState || !activeSessionId) return;
            handleRun(socket, terminalState, activeSessionId);
        });

        // ── Kill running process ──────────────────────────────────────────────
        socket.on("kill", () => {
            if (!terminalState) return;
            handleKill(socket, terminalState);
        });

        // ── Disconnect ───────────────────────────────────────────────────────
        socket.on("disconnect", () => {
            if (terminalState && activeSessionId) {
                handleDisconnect(activeSessionId, terminalState);
            } else {
                console.log(`[WS] Disconnected userId=${userId} (no active session)`);
            }
        });

        socket.on("error", (err) => console.error("[WS] Socket error:", err));
    });

    console.log("[WS] Socket.io terminal server attached");
};

export default initTerminalSocket;
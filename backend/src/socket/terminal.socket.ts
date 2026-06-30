import type { Server as HttpServer } from "http";
import initSocketServer from "./socket";
import { getSession } from "../services/k8s.service";
import type { TerminalState } from "../types";
import { PassThrough } from "stream";
import { handleDisconnect, handleInput, handleKill, handleResize, handleRun, initTerminalExec } from "../controllers/terminal.controller";

const initTerminalSocket = (httpServer: HttpServer): void => {
    const io = initSocketServer(httpServer);

    io.on("connection", async (socket) => {
        const sessionId = socket.handshake.query.session as string | undefined;
        if (!sessionId) {
            socket.disconnect(true);
            return;
        }

        const session = await getSession(sessionId);
        if (!session) {
            socket.emit("error", "Session not found or expired");
            socket.disconnect(true);
            return;
        }

        console.log(`[WS] Connected session=${sessionId} pod=${session.podName}`);

        const state: TerminalState = {
            session,
            stdinStream: new PassThrough(),
            stdoutStream: new PassThrough(),
            execWebSocket: null,
            runExecWs: null,
            runTimeout: null,
            lineBuffer: "",
            trackedCwd: session.workspacePath,
            previousCwd: session.workspacePath
        };

        await initTerminalExec(socket, state);

        socket.on("input", ({ data }) => {
            handleInput(
                data,
                socket,
                state,
                sessionId
            );
        });

        socket.on("resize", ({ cols, rows }) => {
            handleResize(
                cols,
                rows,
                state
            );
        });

        socket.on("run", () => {
            handleRun(
                socket,
                state,
                sessionId
            );
        });

        socket.on("kill", () => {
            handleKill(socket, state);
        });

        socket.on("disconnect", () => {
            handleDisconnect(sessionId, state);
        });

        socket.on("error", (err) => console.error("[WS] Socket error:", err));
    });

    console.log("[WS] Socket.io terminal server attached");
}

export default initTerminalSocket;
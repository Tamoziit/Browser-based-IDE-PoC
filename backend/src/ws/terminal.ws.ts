import type { IncomingMessage, Server } from "http";
import WebSocket, { WebSocketServer } from "ws";
import { getSession, refreshSession } from "../services/docker.service.js";
import * as pty from "node-pty";
import type { WsMessage } from "../types/index.d.ts";

const initTerminalWS = (httpServer: Server): void => {
    // Attaching the WS server to the same HTTP server — Vite proxy will handle ws:// → /ws
    const wss = new WebSocketServer({
        server: httpServer,
        path: "/ws"
    });

    wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
        // Parsing ?session=<id> from URL
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

        console.log(`[WS] Terminal connected session=${sessionId}`);

        // Spawning docker exec -it <containerId> bash as a PTY process
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

        ptyProc.onData((data: string) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(data);
            }
        });

        ptyProc.onExit(({ exitCode }) => {
            console.log(`[WS] PTY exited session=${sessionId} code=${exitCode}`);

            if (ws.readyState === WebSocket.OPEN) {
                ws.send("\r\n\x1b[31m[Terminal closed]\x1b[0m\r\n");
                ws.close(1000, "Terminal exited");
            }
        });

        // WebSocket → PTY: messages from browser
        ws.on("message", async (raw: Buffer | string) => {
            try {
                const msg: WsMessage = JSON.parse(raw.toString());

                if (msg.type === "resize") {
                    ptyProc.resize(
                        Math.max(1, msg.cols),
                        Math.max(1, msg.rows)
                    );
                } else if (msg.type === "input") {
                    ptyProc.write(msg.data);
                    await refreshSession(sessionId);   // any keypress resets TTL
                }
            } catch {
                ptyProc.write(raw.toString());
                await refreshSession(sessionId);
            }
        });

        ws.on("close", () => {
            console.log(`[WS] Disconnected session=${sessionId}`);
            try { ptyProc.kill(); } catch { }
        });

        ws.on("error", (err) => {
            console.error("[WS] Socket error:", err);
            try { ptyProc.kill(); } catch { }
        });
    });

    console.log("[WS] Terminal WebSocket server attached");
}

export default initTerminalWS;
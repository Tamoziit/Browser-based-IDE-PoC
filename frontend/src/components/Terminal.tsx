import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { TerminalProps } from "../interfaces";

const TerminalPanel = ({ sessionId, socket }: TerminalProps) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);

    useEffect(() => {
        if (!containerRef.current || !socket) return;

        const term = new Terminal({
            cursorBlink: true,
            fontSize: 13,
            fontFamily: '"Cascadia Code", "Fira Code", monospace',
            theme: {
                background: "#0d1117",
                foreground: "#e6edf3",
                cursor: "#58a6ff",
                selectionBackground: "#264f78",
            },
            scrollback: 5000,
            allowProposedApi: true,
        });
        termRef.current = term;

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(containerRef.current);

        // Small delay to let the DOM settle before fitting
        setTimeout(() => fitAddon.fit(), 50);

        // ── Socket.io event handlers ──────────────────────────────────────────

        const handleConnect = () => {
            term.write("\x1b[32m[Connected to lab terminal]\x1b[0m\r\n");
            // Send initial terminal size to the server
            socket.emit("resize", { cols: term.cols, rows: term.rows });
        };

        // Raw PTY output + run output both come as "output" events
        const handleOutput = ({ data }: { data: string }) => {
            term.write(data);
        };

        const handleDisconnect = () => {
            term.write("\r\n\x1b[31m[Terminal disconnected]\x1b[0m\r\n");
        };

        const handleError = (err: unknown) => {
            console.error("[TerminalPanel] Socket error:", err);
            term.write("\r\n\x1b[31m[Socket error]\x1b[0m\r\n");
        };

        if (socket.connected) {
            handleConnect();
        } else {
            socket.once("connect", handleConnect);
        }

        socket.on("output", handleOutput);
        socket.on("disconnect", handleDisconnect);
        socket.on("connect_error", handleError);

        // ── User input → backend PTY ──────────────────────────────────────────
        const dataDisposable = term.onData((data: string) => {
            if (socket.connected) {
                socket.emit("input", { data });
            }
        });

        // ── Resize: observer fires when the panel is resized ──────────────────
        const ro = new ResizeObserver(() => {
            try {
                fitAddon.fit();
                if (socket.connected) {
                    socket.emit("resize", { cols: term.cols, rows: term.rows });
                }
            } catch (err) {
                console.error("Terminal resize failed:", err);
            }
        });
        ro.observe(containerRef.current);

        return () => {
            dataDisposable.dispose();
            socket.off("connect", handleConnect);
            socket.off("output", handleOutput);
            socket.off("disconnect", handleDisconnect);
            socket.off("connect_error", handleError);
            term.dispose();
            ro.disconnect();
        };
    // Re-run only when the sessionId or socket instance changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId, socket]);

    return (
        <div
            ref={containerRef}
            className="terminal-container"
            style={{ height: "100%", width: "100%" }}
        />
    );
};

export default TerminalPanel;
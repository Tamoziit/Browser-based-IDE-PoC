import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { TerminalProps } from "../interfaces";

const TerminalPanel = ({ sessionId }: TerminalProps) => {
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!containerRef.current) return;

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

		const fitAddon = new FitAddon();
		term.loadAddon(fitAddon);
		term.open(containerRef.current);

		// Small delay to let the DOM settle before fitting
		setTimeout(() => fitAddon.fit(), 50);

		// WebSocket to the backend — proxied by Vite in dev
		const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
		const ws = new WebSocket(`${proto}//${window.location.host}/ws?session=${sessionId}`);

		ws.onopen = () => {
			term.write("\x1b[32m[Connected to lab terminal]\x1b[0m\r\n");
			// Send initial size
			ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
		};

		ws.onmessage = (event: MessageEvent<string>) => {
			term.write(event.data);
		};

		ws.onerror = () => {
			term.write("\r\n\x1b[31m[WebSocket error]\x1b[0m\r\n");
		};

		ws.onclose = () => {
			term.write("\r\n\x1b[31m[Terminal disconnected]\x1b[0m\r\n");
		};

		// User input → backend PTY
		term.onData((data: string) => {
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ type: "input", data }));
			}
		});

		// Resize: observer fires when the panel is resized by the user
		const ro = new ResizeObserver(() => {
			try {
				fitAddon.fit();
				if (ws.readyState === WebSocket.OPEN) {
					ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
				}
			} catch (err) {
				console.error("Terminal resize failed:", err);
			}
		});
		ro.observe(containerRef.current);

		return () => {
			ws.close();
			term.dispose();
			ro.disconnect();
		};
	}, [sessionId]);

	return <div ref={containerRef} className="terminal-container" />;
}

export default TerminalPanel;
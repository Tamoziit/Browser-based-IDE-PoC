import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { TerminalProps } from "../interfaces";

const TerminalPanel = ({ sessionId, ws: sharedWs }: TerminalProps) => {
	const containerRef = useRef<HTMLDivElement>(null);
	const termRef = useRef<Terminal | null>(null);

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
		termRef.current = term;

		const fitAddon = new FitAddon();
		term.loadAddon(fitAddon);
		term.open(containerRef.current);

		// Small delay to let the DOM settle before fitting
		setTimeout(() => fitAddon.fit(), 50);

		let ws = sharedWs;
		let localWsCreated = false;

		if (!ws) {
			const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
			ws = new WebSocket(`${proto}//${window.location.host}/ws?session=${sessionId}`);
			localWsCreated = true;
		}

		const handleOpen = () => {
			term.write("\x1b[32m[Connected to lab terminal]\x1b[0m\r\n");
			// Send initial size
			ws!.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
		};

		const handleMessage = (event: MessageEvent<string>) => {
			// We only want to write raw PTY strings to the terminal.
			// The run/output protocol uses JSON, so we skip JSON messages here.
			if (event.data.startsWith("{") && event.data.endsWith("}")) {
				try {
					const msg = JSON.parse(event.data);
					if (msg.type) return; // It's a structured message, ignore it
				} catch {
					// Not valid JSON, treat as raw text
				}
			}
			term.write(event.data);
		};

		const handleError = () => {
			term.write("\r\n\x1b[31m[WebSocket error]\x1b[0m\r\n");
		};

		const handleClose = () => {
			term.write("\r\n\x1b[31m[Terminal disconnected]\x1b[0m\r\n");
		};

		if (ws.readyState === WebSocket.OPEN) {
			handleOpen();
		} else {
			ws.addEventListener("open", handleOpen);
		}
		ws.addEventListener("message", handleMessage);
		ws.addEventListener("error", handleError);
		ws.addEventListener("close", handleClose);

		// User input → backend PTY
		const dataDisposable = term.onData((data: string) => {
			if (ws && ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ type: "input", data }));
			}
		});

		// Resize: observer fires when the panel is resized by the user
		const ro = new ResizeObserver(() => {
			try {
				fitAddon.fit();
				if (ws && ws.readyState === WebSocket.OPEN) {
					ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
				}
			} catch (err) {
				console.error("Terminal resize failed:", err);
			}
		});
		ro.observe(containerRef.current);

		return () => {
			dataDisposable.dispose();
			if (ws) {
				ws.removeEventListener("open", handleOpen);
				ws.removeEventListener("message", handleMessage);
				ws.removeEventListener("error", handleError);
				ws.removeEventListener("close", handleClose);
				if (localWsCreated) {
					ws.close();
				}
			}
			term.dispose();
			ro.disconnect();
		};
	}, [sessionId, sharedWs]);

	return <div ref={containerRef} className="terminal-container" style={{ height: "100%", width: "100%" }} />;
}

export default TerminalPanel;
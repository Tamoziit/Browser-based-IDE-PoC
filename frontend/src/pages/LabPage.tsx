/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { useState, useEffect, useCallback, useRef } from "react";
import FileTree from "../components/FileTree";
import MonacoEditor from "../components/MonacoEditor";
import TerminalPanel from "../components/Terminal";
import { labApi } from "../services/lab.api";
import type { TabId } from "../interfaces";

// For the PoC: hardcoded user/lab IDs
// In production: read from auth context / route params
const DEMO_USER_ID = "user-demo";
const DEMO_LAB_ID = "lab-001";

const LabPage = () => {
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [booting, setBooting] = useState(true);

	const [selectedFile, setSelectedFile] = useState("main.py");
	const [code, setCode] = useState("");
	const [saving, setSaving] = useState(false);
	const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");

	const [activeTab, setActiveTab] = useState<TabId>("terminal");
	const [output, setOutput] = useState<string>("");
	const [running, setRunning] = useState(false);

	const fileTreeRefreshRef = useRef<(() => void) | null>(null);

	// ── Boot ──────────────────────────────────────────────────────────────────────

	useEffect(() => {
		(async () => {
			try {
				const { sessionId: sid } = await labApi.startLab(DEMO_USER_ID, DEMO_LAB_ID);
				setSessionId(sid);
			} catch (err: any) {
				setError(err.message);
			} finally {
				setBooting(false);
			}
		})();

		// Stop lab on page unload
		return () => {
			if (sessionId) labApi.stopLab(sessionId).catch(() => { });
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// ── Load file when selection changes ──────────────────────────────────────────

	useEffect(() => {
		if (!sessionId || !selectedFile) return;
		labApi.readFile(sessionId, selectedFile)
			.then(({ content }) => setCode(content))
			.catch(() => setCode(""));
	}, [sessionId, selectedFile]);

	const handleSave = useCallback(async () => {
		if (!sessionId) return;
		setSaving(true);
		try {
			await labApi.saveFile(sessionId, selectedFile, code);
			setSaveStatus("saved");
			setTimeout(() => setSaveStatus("idle"), 1500);
		} catch {
			setSaveStatus("error");
		} finally {
			setSaving(false);
		}
	}, [sessionId, selectedFile, code]);

	// ── Ctrl+S from Monaco ────────────────────────────────────────────────────────

	useEffect(() => {
		const handler = () => handleSave();
		window.addEventListener("editor:save", handler);
		return () => window.removeEventListener("editor:save", handler);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [sessionId, selectedFile, code]);

	// ── Actions ───────────────────────────────────────────────────────────────────

	const handleRun = useCallback(async () => {
		if (!sessionId || running) return;
		setRunning(true);
		setActiveTab("output");
		setOutput("Running…\n");
		try {
			await labApi.saveFile(sessionId, selectedFile, code);
			const { output: out } = await labApi.runCode(sessionId);
			setOutput(out || "(no output)");
		} catch (err: any) {
			setOutput(`Error: ${err.message}`);
		} finally {
			setRunning(false);
		}
	}, [sessionId, running, selectedFile, code]);

	// ── Render States ─────────────────────────────────────────────────────────────

	if (booting) {
		return (
			<div className="boot-screen">
				<div className="boot-spinner" />
				<p>Provisioning your lab container…</p>
			</div>
		);
	}

	if (error || !sessionId) {
		return (
			<div className="boot-screen error">
				<p>⚠ Failed to start lab: {error}</p>
				<button onClick={() => window.location.reload()}>Retry</button>
			</div>
		);
	}

	// ── Main Layout ───────────────────────────────────────────────────────────────

	return (
		<div className="lab-layout">

			{/* ── Header ── */}
			<header className="lab-header">
				<div className="header-left">
					<span className="header-logo">⬡ LMS Lab</span>
					<span className="header-file">{selectedFile}</span>
					{saveStatus === "saved" && <span className="save-badge saved">✓ Saved</span>}
					{saveStatus === "error" && <span className="save-badge error">✗ Save failed</span>}
				</div>
				<div className="header-right">
					<button className="btn btn-save" onClick={handleSave} disabled={saving}>
						{saving ? "Saving…" : "Save"}
					</button>
					<button className="btn btn-run" onClick={handleRun} disabled={running}>
						{running ? "Running…" : "▶ Run"}
					</button>
				</div>
			</header>

			{/* ── Body (Files + Editor) ── */}
			<div className="lab-body">
				<aside className="file-panel">
					<FileTree
						sessionId={sessionId}
						selectedFile={selectedFile}
						onSelect={setSelectedFile}
					/>
				</aside>

				<main className="editor-panel">
					<MonacoEditor
						language="python"
						value={code}
						onChange={(v) => setCode(v ?? "")}
					/>
				</main>
			</div>

			{/* ── Bottom Pane (Terminal + Output tabs) ── */}
			<div className="bottom-pane">
				<div className="pane-tabs">
					<button
						className={`pane-tab ${activeTab === "terminal" ? "active" : ""}`}
						onClick={() => setActiveTab("terminal")}
					>
						Terminal
					</button>
					<button
						className={`pane-tab ${activeTab === "output" ? "active" : ""}`}
						onClick={() => setActiveTab("output")}
					>
						Output
					</button>
				</div>

				<div className="pane-content">
					{/* Always render Terminal so the WS stays connected */}
					<div style={{ display: activeTab === "terminal" ? "block" : "none", height: "100%" }}>
						<TerminalPanel sessionId={sessionId} />
					</div>

					{activeTab === "output" && (
						<pre className="output-panel">{output}</pre>
					)}
				</div>
			</div>

		</div>
	);
}

export default LabPage;
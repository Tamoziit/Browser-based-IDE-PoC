/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, Navigate } from "react-router-dom";
import FileTree from "../components/FileTree";
import MonacoEditor from "../components/MonacoEditor";
import TerminalPanel from "../components/Terminal";
import { labApi } from "../services/lab.api";
import type { LabType, TabId } from "../interfaces";

// For the PoC: hardcoded user/lab IDs
const DEMO_USER_ID = "user-demo";
const DEMO_LAB_ID = "lab-001";

const VALID_LAB_TYPES: LabType[] = ["RO_EXEC", "RWX"];

type ConfirmAction = "back" | "submit" | null;

const LabPage = () => {
	// ── Routing ──────────────────────────────────────────────────────────────
	const { labType: labTypeParam } = useParams<{ labType: string }>();
	const navigate = useNavigate();

	// Validate the URL param — invalid values redirect to /
	const labType = VALID_LAB_TYPES.includes(labTypeParam as LabType)
		? (labTypeParam as LabType)
		: null;

	// ── Lab state ─────────────────────────────────────────────────────────────
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

	// Termination
	const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
	const [terminating, setTerminating] = useState(false);
	const [submitted, setSubmitted] = useState(false);

	// Stable refs to prevent double-execution and double-cleanup
	const sessionIdRef = useRef<string | null>(null);
	const initRef = useRef(false);



	// Derived: is current file read-only?
	const isReadOnly = labType === "RO_EXEC" && selectedFile !== ".env";

	// ── Boot ─────────────────────────────────────────────────────────────────

	useEffect(() => {
		if (!labType) return;   // invalid URL — render guard below handles it
		
		if (initRef.current) return; // StrictMode double-invocation guard
		initRef.current = true;

		(async () => {
			try {
				const { sessionId: sid } = await labApi.startLab(DEMO_USER_ID, DEMO_LAB_ID, labType);
				setSessionId(sid);
				sessionIdRef.current = sid;
			} catch (err: any) {
				setError(err.message);
			} finally {
				setBooting(false);
			}
		})();

		// Safety: terminate on tab close / refresh
		return () => {
			if (sessionIdRef.current) {
				labApi.stopLab(sessionIdRef.current).catch(() => { });
			}
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// ── Load file ─────────────────────────────────────────────────────────────

	useEffect(() => {
		if (!sessionId || !selectedFile) return;
		labApi.readFile(sessionId, selectedFile)
			.then(({ content }) => setCode(content))
			.catch(() => setCode(""));
	}, [sessionId, selectedFile]);

	// ── Save ─────────────────────────────────────────────────────────────────

	const handleSave = useCallback(async () => {
		if (!sessionId || isReadOnly) return;
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
	}, [sessionId, selectedFile, code, isReadOnly]);

	// Ctrl+S from Monaco
	useEffect(() => {
		const handler = () => handleSave();
		window.addEventListener("editor:save", handler);
		return () => window.removeEventListener("editor:save", handler);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [sessionId, selectedFile, code]);

	// ── Run ──────────────────────────────────────────────────────────────────

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

	// ── Session termination ───────────────────────────────────────────────────

	const terminateSession = useCallback(async () => {
		const sid = sessionIdRef.current;
		if (!sid) return;
		setTerminating(true);
		try {
			await labApi.stopLab(sid);
			sessionIdRef.current = null;   // prevent double-stop in cleanup
		} catch { /* best-effort */ }
	}, []);

	/** Back: terminate → navigate to "/" */
	const handleConfirmBack = useCallback(async () => {
		setConfirmAction(null);
		await terminateSession();
		navigate("/", { replace: true });
	}, [terminateSession, navigate]);

	/** Submit: terminate → show success flash → navigate to "/" */
	const handleConfirmSubmit = useCallback(async () => {
		setConfirmAction(null);
		await terminateSession();
		setSubmitted(true);
		setTimeout(() => navigate("/", { replace: true }), 2000);
	}, [terminateSession, navigate]);

	// ── Render guards ─────────────────────────────────────────────────────────

	// Invalid URL param → redirect to selection
	if (!labType) return <Navigate to="/" replace />;

	if (booting) {
		return (
			<div className="boot-screen">
				<div className="boot-spinner" />
				<p>Provisioning your {labType === "RO_EXEC" ? "Read-Only & Execute" : "RWX"} lab…</p>
			</div>
		);
	}

	if (error || !sessionId) {
		return (
			<div className="boot-screen error">
				<p>⚠ Failed to start lab: {error}</p>
				<button onClick={() => navigate("/", { replace: true })}>← Back to selection</button>
			</div>
		);
	}

	if (terminating && !submitted) {
		return (
			<div className="boot-screen">
				<div className="boot-spinner" />
				<p>Terminating session…</p>
			</div>
		);
	}

	if (submitted) {
		return (
			<div className="boot-screen submitted-screen">
				<div className="submitted-icon">✓</div>
				<h2 className="submitted-title">Lab Submitted</h2>
				<p className="submitted-sub">Your session has been recorded. Returning to selection…</p>
			</div>
		);
	}



	// ── Main Layout ───────────────────────────────────────────────────────────

	return (
		<>
			{/* ── Confirmation Modal ── */}
			{confirmAction && (
				<div className="modal-backdrop" onClick={() => setConfirmAction(null)}>
					<div
						className="modal-card"
						role="dialog"
						aria-modal="true"
						onClick={(e) => e.stopPropagation()}   // don't close on inner click
					>
						{confirmAction === "back" ? (
							<>
								<div className="modal-icon">↩</div>
								<h2 className="modal-title">Leave Lab?</h2>
								<p className="modal-body">
									Going back will <strong>immediately terminate</strong> your
									session and stop the container. Any unsaved changes will be lost.
								</p>
							</>
						) : (
							<>
								<div className="modal-icon modal-icon--submit">✓</div>
								<h2 className="modal-title">Submit Lab?</h2>
								<p className="modal-body">
									Submitting will <strong>end your session</strong> and record
									your work. You will not be able to return to this session.
								</p>
							</>
						)}

						<div className="modal-actions">
							<button
								id="btn-modal-cancel"
								className="btn modal-btn-cancel"
								onClick={() => setConfirmAction(null)}
							>
								Cancel
							</button>
							<button
								id={confirmAction === "back" ? "btn-modal-back-confirm" : "btn-modal-submit-confirm"}
								className={`btn ${confirmAction === "back" ? "modal-btn-back" : "modal-btn-submit"}`}
								onClick={confirmAction === "back" ? handleConfirmBack : handleConfirmSubmit}
							>
								{confirmAction === "back" ? "Leave Session" : "Submit"}
							</button>
						</div>
					</div>
				</div>
			)}

			<div className="lab-layout">

				{/* ── Header ── */}
				<header className="lab-header">
					<div className="header-left">
						<button
							id="btn-back"
							className="btn btn-back"
							title="Leave lab and return to selection"
							onClick={() => setConfirmAction("back")}
						>
							← Back
						</button>

						<span className="header-logo">⬡ LMS Lab</span>

						{labType === "RO_EXEC" ? (
							<span className="lab-type-badge lab-type-badge--ro" title="Read-Only & Execute — source files are protected">
								🔒 Read-Only
							</span>
						) : (
							<span className="lab-type-badge lab-type-badge--rwx" title="Read-Write-Execute — full access">
								⚡ RWX
							</span>
						)}

						<span className="header-file">{selectedFile}</span>
						{saveStatus === "saved" && <span className="save-badge saved">✓ Saved</span>}
						{saveStatus === "error" && <span className="save-badge error">✗ Save failed</span>}
					</div>

					<div className="header-right">
						{!isReadOnly && (
							<button className="btn btn-save" onClick={handleSave} disabled={saving}>
								{saving ? "Saving…" : "Save"}
							</button>
						)}
						<button className="btn btn-run" onClick={handleRun} disabled={running}>
							{running ? "Running…" : "▶ Run"}
						</button>
						<button
							id="btn-submit"
							className="btn btn-submit"
							title="Submit lab and end session"
							onClick={() => setConfirmAction("submit")}
						>
							Submit ✓
						</button>
					</div>
				</header>

				{/* ── Body ── */}
				<div className="lab-body">
					<aside className="file-panel">
						<FileTree
							sessionId={sessionId}
							selectedFile={selectedFile}
							onSelect={setSelectedFile}
							labType={labType}
						/>
					</aside>
					<main className="editor-panel">
						<MonacoEditor
							language="python"
							value={code}
							onChange={(v) => setCode(v ?? "")}
							readOnly={isReadOnly}
						/>
					</main>
				</div>

				{/* ── Bottom Pane ── */}
				<div className="bottom-pane">
					<div className="pane-tabs">
						<button
							className={`pane-tab ${activeTab === "terminal" ? "active" : ""}`}
							onClick={() => setActiveTab("terminal")}
						>Terminal</button>
						<button
							className={`pane-tab ${activeTab === "output" ? "active" : ""}`}
							onClick={() => setActiveTab("output")}
						>Output</button>
					</div>
					<div className="pane-content">
						<div style={{ display: activeTab === "terminal" ? "block" : "none", height: "100%" }}>
							<TerminalPanel sessionId={sessionId} />
						</div>
						{activeTab === "output" && (
							<pre className="output-panel">{output}</pre>
						)}
					</div>
				</div>

			</div>
		</>
	);
};

export default LabPage;
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, Navigate } from "react-router-dom";
import FileTree from "../components/FileTree";
import MonacoEditor from "../components/MonacoEditor";
import TerminalPanel from "../components/Terminal";
import { labApi } from "../services/lab.api";
import { useSocketContext } from "../context/SocketContext";
import type { ConfirmAction, LabType, SubmissionResult, TabId } from "../interfaces";
import ResultPanel from "../components/ResultPanel";

const VALID_LAB_TYPES: LabType[] = ["RO_EXEC", "RWX"];

const LabPage = () => {
    // ── Routing ──────────────────────────────────────────────────────────────
    const { labType: labTypeParam } = useParams<{ labType: string }>();
    const navigate = useNavigate();

    // Validate the URL param — invalid values redirect to /
    const labType = VALID_LAB_TYPES.includes(labTypeParam as LabType)
        ? (labTypeParam as LabType)
        : null;

    // ── Global Socket from Context ────────────────────────────────────────────
    const { socket } = useSocketContext();

    // ── Lab state ─────────────────────────────────────────────────────────────
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [booting, setBooting] = useState(true);

    const [selectedFile, setSelectedFile] = useState("main.py");
    const [code, setCode] = useState("");
    const [saving, setSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");

    // RO_EXEC: output-only pane; RWX: terminal + output tabs
    const [activeTab, setActiveTab] = useState<TabId>(
        labType === "RO_EXEC" ? "output" : "terminal"
    );
    const [output, setOutput] = useState<string>("");
    const [running, setRunning] = useState(false);

    // Output buffer to prevent React from freezing on fast streams
    const outputBufferRef = useRef<string>("");

    // Termination
    const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
    const [terminating, setTerminating] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [submissionResult, setSubmissionResult] = useState<SubmissionResult | null>(null);

    // Stable refs to prevent double-execution and double-cleanup
    const sessionIdRef = useRef<string | null>(null);
    const initRef = useRef(false);

    // In-memory cache of unsaved edits, keyed by filename
    const fileCacheRef = useRef<Map<string, string>>(new Map());

    // Ref that always holds the latest code value (avoids stale closure in handleFileSelect)
    const codeRef = useRef(code);
    useEffect(() => { codeRef.current = code; }, [code]);

    // Derived: is current file read-only?
    const isReadOnly = labType === "RO_EXEC" && selectedFile !== ".env";

    // ── Boot ─────────────────────────────────────────────────────────────────

    useEffect(() => {
        if (!labType) return; // invalid URL — render guard below handles it

        if (initRef.current) return; // StrictMode double-invocation guard
        initRef.current = true;

        (async () => {
            try {
                // labId is resolved inside labApi from the hardcoded LAB_IDS map
                const { sessionId: sid } = await labApi.startLab(labType);
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

    // ── Socket.io: join session room & listen for run events ──────────────────

    useEffect(() => {
        if (!sessionId || !socket) return;

        // Tell the backend which terminal session this socket belongs to
        socket.emit("join-session", { sessionId });

        let updateTimer: ReturnType<typeof setTimeout> | null = null;

        const flushBuffer = () => {
            if (outputBufferRef.current.length > 0) {
                const currentText = outputBufferRef.current;
                setOutput((prev) => {
                    let next = prev + currentText;
                    // Cap length to prevent browser OOM on infinite loops
                    if (next.length > 50000) {
                        next = "[...truncated...]\n" + next.slice(-50000);
                    }
                    return next;
                });
                outputBufferRef.current = "";
            }
        };

        // "output" carries both PTY data and run stdout/stderr
        const handleOutput = ({ data }: { data: string }) => {
            outputBufferRef.current += data;
            if (!updateTimer) {
                updateTimer = setTimeout(() => {
                    flushBuffer();
                    updateTimer = null;
                }, 50); // flush at most 20× per second
            }
        };

        const handleExit = () => {
            flushBuffer();
            setRunning(false);
        };

        const handleRunError = ({ message }: { message: string }) => {
            flushBuffer();
            setOutput((prev) => prev + `\n[Error: ${message}]\n`);
            setRunning(false);
        };

        socket.on("output", handleOutput);
        socket.on("exit", handleExit);
        socket.on("run_error", handleRunError);

        return () => {
            if (updateTimer) clearTimeout(updateTimer);
            socket.off("output", handleOutput);
            socket.off("exit", handleExit);
            socket.off("run_error", handleRunError);
        };
    }, [sessionId, socket]);

    // ── File selection (stash current edits, then load new file) ──────────────

    const handleFileSelect = useCallback((newFile: string) => {
        if (newFile === selectedFile) return;
        // Stash current edits
        fileCacheRef.current.set(selectedFile, codeRef.current);
        setSelectedFile(newFile);
    }, [selectedFile]);

    // ── Load file ─────────────────────────────────────────────────────────────

    useEffect(() => {
        if (!sessionId || !selectedFile) return;
        // Serve from cache first so unsaved edits are never lost
        if (fileCacheRef.current.has(selectedFile)) {
            setCode(fileCacheRef.current.get(selectedFile)!);
            return;
        }
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
            // Clear the cache entry — the file on disk is now up-to-date
            fileCacheRef.current.delete(selectedFile);
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
        if (!sessionId || running || !socket) return;
        setRunning(true);
        setActiveTab("output");
        setOutput("Running…\n");
        try {
            // RO_EXEC: files are protected — skip the pre-run save entirely.
            if (!isReadOnly) {
                await labApi.saveFile(sessionId, selectedFile, code);
            }
            socket.emit("run");
        } catch (err: any) {
            setOutput((prev) => prev + `\n[Error: ${err.message}]`);
            setRunning(false);
        }
    }, [sessionId, running, socket, selectedFile, code, isReadOnly]);

    const handleKill = useCallback(() => {
        if (socket && socket.connected) {
            socket.emit("kill");
        }
    }, [socket]);

    // ── Session termination ───────────────────────────────────────────────────

    const terminateSession = useCallback(async () => {
        const sid = sessionIdRef.current;
        if (!sid) return;
        setTerminating(true);
        try {
            await labApi.stopLab(sid);
            sessionIdRef.current = null; // prevent double-stop in cleanup
        } catch { /* best-effort */ }
    }, []);

    /** Back: terminate → navigate to "/" */
    const handleConfirmBack = useCallback(async () => {
        setConfirmAction(null);
        await terminateSession();
        navigate("/", { replace: true });
    }, [terminateSession, navigate]);

    /** Submit: save → evaluate → show result */
    const handleConfirmSubmit = useCallback(async () => {
        setConfirmAction(null);
        setSubmitting(true);
        const sid = sessionIdRef.current;
        if (!sid) return;

        try {
            // Ensure files are saved before submitting if RWX
            if (!isReadOnly) {
                await labApi.saveFile(sid, selectedFile, code);
            }

            const result = await labApi.submitLab(sid);
            setSubmissionResult(result);
            sessionIdRef.current = null; // Session is already stopped by backend
            setSubmitted(true);
        } catch (err: any) {
            setError(`Submission failed: ${err.message}`);
        } finally {
            setSubmitting(false);
        }
    }, [code, isReadOnly, selectedFile]);

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

    if (terminating && !submitted && !submitting) {
        return (
            <div className="boot-screen">
                <div className="boot-spinner" />
                <p>Terminating session…</p>
            </div>
        );
    }

    if (submitting) {
        return (
            <div className="boot-screen">
                <div className="boot-spinner" />
                <p>Evaluating submission…</p>
            </div>
        );
    }

    if (submitted && submissionResult) {
        return (
            <ResultPanel
                submissionResult={submissionResult}
            />
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
                        {running ? (
                            <button className="btn btn-run" style={{ backgroundColor: "#da3633", borderColor: "#da3633" }} onClick={handleKill}>
                                ◼ Stop
                            </button>
                        ) : (
                            <button className="btn btn-run" onClick={handleRun}>
                                ▶ Run
                            </button>
                        )}
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
                            onSelect={handleFileSelect}
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
                    {/* RO_EXEC: output-only — no tab bar, no terminal */}
                    {labType === "RO_EXEC" ? (
                        <>
                            <div className="pane-tabs">
                                <button className="pane-tab active">Output</button>
                            </div>
                            <div className="pane-content">
                                <pre className="output-panel">{output || "(Run your code to see output here)"}</pre>
                            </div>
                        </>
                    ) : (
                        /* RWX: terminal + output tabs */
                        <>
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
                                    {socket && (
                                        <TerminalPanel sessionId={sessionId} socket={socket} />
                                    )}
                                </div>
                                {activeTab === "output" && (
                                    <pre className="output-panel">{output}</pre>
                                )}
                            </div>
                        </>
                    )}
                </div>

            </div>
        </>
    );
};

export default LabPage;
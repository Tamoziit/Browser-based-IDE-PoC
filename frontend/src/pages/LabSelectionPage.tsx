import { useNavigate } from "react-router-dom";
import type { LabType } from "../interfaces";

const RO_FEATURES = [
    { allowed: true,  label: "Execute code in the terminal" },
    { allowed: true,  label: "Use the integrated terminal" },
    { allowed: true,  label: "Read all project files" },
    { allowed: true,  label: "Install dependencies" },
    { allowed: true,  label: "Run build & execution commands" },
    { allowed: true,  label: "Create & modify .env file" },
    { allowed: false, label: "Edit source code files" },
    { allowed: false, label: "Create or delete files" },
    { allowed: false, label: "Copy / export file contents" },
    { allowed: false, label: "Download any file" },
];

const RWX_FEATURES = [
    { allowed: true,  label: "Read & write all files" },
    { allowed: true,  label: "Create & delete files / folders" },
    { allowed: true,  label: "Execute code in the terminal" },
    { allowed: true,  label: "Install dependencies" },
    { allowed: true,  label: "Run build & execution commands" },
    { allowed: true,  label: "Full editor access" },
    { allowed: false, label: "Download files (blocked for all labs)" },
];

const LabSelectionPage = () => {
    const navigate = useNavigate();

    const launch = (labType: LabType) => navigate(`/lab/${labType}`);

    return (
        <div className="selection-page">
            {/* Animated background grid */}
            <div className="selection-bg-grid" aria-hidden="true" />

            <div className="selection-content">
                {/* Header */}
                <div className="selection-header">
                    <span className="selection-logo">⬡ LMS Lab</span>
                    <h1 className="selection-title">Choose Your Lab Environment</h1>
                    <p className="selection-subtitle">
                        Select the workspace type that matches your session requirements.
                        All restrictions are enforced server-side.
                    </p>
                </div>

                {/* Cards */}
                <div className="selection-cards">

                    {/* ── Read-Only & Execute ── */}
                    <div
                        id="lab-card-ro"
                        className="lab-card lab-card--ro"
                        onClick={() => launch("RO_EXEC")}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => e.key === "Enter" && launch("RO_EXEC")}
                        aria-label="Select Read-Only and Execute lab"
                    >
                        <div className="lab-card-glow" aria-hidden="true" />
                        <div className="lab-card-header">
                            <span className="lab-card-icon">🔒</span>
                            <div>
                                <h2 className="lab-card-title">Read-Only &amp; Execute</h2>
                                <p className="lab-card-subtitle">Restricted workspace</p>
                            </div>
                        </div>

                        <p className="lab-card-desc">
                            Run and explore code without modifying source files.
                            Only the <code>.env</code> file is writable.
                        </p>

                        <ul className="feature-list">
                            {RO_FEATURES.map((f) => (
                                <li key={f.label} className={`feature-item ${f.allowed ? "allowed" : "denied"}`}>
                                    <span className="feature-icon">{f.allowed ? "✓" : "✕"}</span>
                                    <span>{f.label}</span>
                                </li>
                            ))}
                        </ul>

                        <button
                            id="btn-launch-ro"
                            className="lab-card-btn lab-card-btn--ro"
                            onClick={(e) => { e.stopPropagation(); launch("RO_EXEC"); }}
                        >
                            Launch Read-Only Lab
                        </button>
                    </div>

                    {/* ── RWX ── */}
                    <div
                        id="lab-card-rwx"
                        className="lab-card lab-card--rwx"
                        onClick={() => launch("RWX")}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => e.key === "Enter" && launch("RWX")}
                        aria-label="Select Read-Write-Execute lab"
                    >
                        <div className="lab-card-glow" aria-hidden="true" />
                        <div className="lab-card-header">
                            <span className="lab-card-icon">⚡</span>
                            <div>
                                <h2 className="lab-card-title">Read-Write-Execute</h2>
                                <p className="lab-card-subtitle">Full workspace access</p>
                            </div>
                        </div>

                        <p className="lab-card-desc">
                            Full interactive development environment with complete
                            filesystem access and editor capabilities.
                        </p>

                        <ul className="feature-list">
                            {RWX_FEATURES.map((f) => (
                                <li key={f.label} className={`feature-item ${f.allowed ? "allowed" : "denied"}`}>
                                    <span className="feature-icon">{f.allowed ? "✓" : "✕"}</span>
                                    <span>{f.label}</span>
                                </li>
                            ))}
                        </ul>

                        <button
                            id="btn-launch-rwx"
                            className="lab-card-btn lab-card-btn--rwx"
                            onClick={(e) => { e.stopPropagation(); launch("RWX"); }}
                        >
                            Launch RWX Lab
                        </button>
                    </div>

                </div>

                <p className="selection-footer">
                    All permission checks are enforced at the server layer — frontend bypass attempts have no effect.
                </p>
            </div>
        </div>
    );
};

export default LabSelectionPage;

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useCallback } from "react";
import { labApi } from "../services/lab.api";
import type { FileEntry, FileTreeProps } from "../interfaces";

const FileTree = ({ sessionId, selectedFile, onSelect, labType }: FileTreeProps) => {
    const [files, setFiles] = useState<FileEntry[]>([]);
    const [loading, setLoading] = useState(false);

    const isRO = labType === "RO_EXEC";

    const loadFiles = useCallback(async () => {
        setLoading(true);
        try {
            const list = await labApi.listFiles(sessionId);
            // Dirs first, then files, both alphabetical
            list.sort((a, b) => {
                if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
                return a.name.localeCompare(b.name);
            });
            setFiles(list);
        } catch (err) {
            console.error("FileTree load error:", err);
        } finally {
            setLoading(false);
        }
    }, [sessionId]);

    useEffect(() => {
        loadFiles();
    }, [loadFiles]);

    async function handleNewFile() {
        if (isRO) return; // guard — backend also rejects
        const name = window.prompt("File name (e.g. solution.py):");
        if (!name?.trim()) return;
        try {
            await labApi.createFile(sessionId, name.trim());
            await loadFiles();
            onSelect(name.trim());
        } catch (err: any) {
            alert(`Failed to create file: ${err.message}`);
        }
    }

    async function handleDelete(name: string, e: React.MouseEvent) {
        e.stopPropagation();
        if (isRO) return; // guard — backend also rejects
        if (!window.confirm(`Delete "${name}"?`)) return;
        try {
            await labApi.deleteFile(sessionId, name);
            await loadFiles();
            if (selectedFile === name) onSelect(files.find(f => f.name !== name)?.name ?? "");
        } catch (err: any) {
            alert(`Failed to delete: ${err.message}`);
        }
    }

    return (
        <div className="file-tree">
            <div className="file-tree-header">
                <span className="file-tree-title">FILES</span>
                {/* Only show New File button in RWX mode */}
                {!isRO && (
                    <button className="icon-btn" onClick={handleNewFile} title="New file" id="btn-new-file">+</button>
                )}
                <button className="icon-btn" onClick={loadFiles} title="Refresh" id="btn-refresh-files">↻</button>
            </div>

            {loading && <div className="file-tree-loading">Loading...</div>}

            <ul className="file-list">
                {files.map((f) => (
                    <li
                        key={f.name}
                        className={`file-item ${f.type} ${selectedFile === f.name ? "selected" : ""} ${isRO && f.name !== ".env" ? "ro-item" : ""}`}
                        onClick={() => f.type === "file" && onSelect(f.name)}
                        title={isRO && f.name !== ".env" ? `${f.name} (read-only)` : f.name}
                    >
                        <span className="file-icon">{f.type === "dir" ? "📁" : "📄"}</span>
                        <span className="file-name">{f.name}</span>
                        {/* .env gets a writable indicator in RO mode */}
                        {isRO && f.name === ".env" && (
                            <span className="env-writable-badge" title=".env is writable">✎</span>
                        )}
                        {/* Delete button only in RWX */}
                        {f.type === "file" && !isRO && (
                            <button
                                className="delete-btn"
                                onClick={(e) => handleDelete(f.name, e)}
                                title="Delete"
                            >
                                ✕
                            </button>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}

export default FileTree;
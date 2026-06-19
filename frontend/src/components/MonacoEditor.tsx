import Editor, { type OnMount } from "@monaco-editor/react";
import type { MonacoEditorProps } from "../interfaces";

const MonacoEditor = ({ language, value, onChange, readOnly = false }: MonacoEditorProps) => {
    const handleMount: OnMount = (editor, monaco) => {
        editor.focus();

        if (readOnly) {
            // ── Read-Only hardening ────────────────────────────────────────────
            // 1. Override Ctrl+C / Cmd+C — suppress clipboard write
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC, () => { /* no-op */ });
            // 2. Override Ctrl+X / Cmd+X
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyX, () => { /* no-op */ });
            // 3. Override Ctrl+A / Cmd+A — prevent select-all for bulk copy
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyA, () => { /* no-op */ });
            // 4. Override Ctrl+S / Cmd+S — save is blocked in RO mode
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => { /* no-op */ });
        } else {
            // Cmd/Ctrl+S triggers save in RWX mode
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
                window.dispatchEvent(new CustomEvent("editor:save"));
            });
        }
    };

    return (
        <div className="editor-wrapper" style={{ position: "relative", height: "100%" }}>
            <Editor
                height="100%"
                language={language}
                value={value}
                onChange={readOnly ? undefined : onChange}
                onMount={handleMount}
                theme="vs-dark"
                options={{
                    readOnly,
                    // Disable context menu entirely in RO mode (blocks right-click → Copy)
                    contextmenu: !readOnly,
                    minimap: { enabled: false },
                    fontSize: 14,
                    lineNumbers: "on",
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    tabSize: 4,
                    wordWrap: "on",
                    formatOnPaste: !readOnly,
                    // Prevent drag-and-drop text selection in RO mode
                    dragAndDrop: !readOnly,
                    // Hide cursor in RO mode for cleaner UX
                    renderLineHighlight: readOnly ? "none" : "all",
                    cursorStyle: readOnly ? "underline-thin" : "line",
                }}
            />
            {/* Subtle read-only watermark overlay */}
            {readOnly && (
                <div className="editor-ro-overlay" aria-hidden="true">
                    READ ONLY
                </div>
            )}
        </div>
    );
}

export default MonacoEditor;
import Editor, { type OnMount } from "@monaco-editor/react";
import type { MonacoEditorProps } from "../interfaces";

const MonacoEditor = ({ language, value, onChange }: MonacoEditorProps) => {
	const handleMount: OnMount = (editor) => {
		editor.focus();
		// Cmd/Ctrl+S triggers save — wire it up via an action
		editor.addCommand(2048 | 49 /* CtrlCmd+S */, () => {
			// Dispatch a custom event so LabPage can listen
			window.dispatchEvent(new CustomEvent("editor:save"));
		});
	};

	return (
		<Editor
			height="100%"
			language={language}
			value={value}
			onChange={onChange}
			onMount={handleMount}
			theme="vs-dark"
			options={{
				minimap: { enabled: false },
				fontSize: 14,
				lineNumbers: "on",
				scrollBeyondLastLine: false,
				automaticLayout: true,
				tabSize: 4,
				wordWrap: "on",
				formatOnPaste: true,
			}}
		/>
	);
}

export default MonacoEditor;
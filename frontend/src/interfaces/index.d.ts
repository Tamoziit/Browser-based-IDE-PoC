import type { OnChange } from "@monaco-editor/react";

export interface FileEntry {
    name: string;
    type: "file" | "dir";
}

export interface TerminalProps {
    sessionId: string;
}

export interface MonacoEditorProps {
    language: string;
    value: string;
    onChange: OnChange;
}

export interface FileTreeProps {
    sessionId: string;
    selectedFile: string;
    onSelect: (name: string) => void;
    onRefresh?: () => void;
}

export type TabId = "terminal" | "output";
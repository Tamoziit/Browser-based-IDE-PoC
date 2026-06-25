import type { OnChange } from "@monaco-editor/react";

export type LabType = "RO_EXEC" | "RWX";

export interface FileEntry {
    name: string;
    type: "file" | "dir";
}

export interface TerminalProps {
    sessionId: string;
    ws?: WebSocket | null;
}

export interface MonacoEditorProps {
    language: string;
    value: string;
    onChange: OnChange;
    readOnly?: boolean;
}

export interface FileTreeProps {
    sessionId: string;
    selectedFile: string;
    onSelect: (name: string) => void;
    onRefresh?: () => void;
    labType: LabType;
}

export type TabId = "terminal" | "output";

export interface ResizeMessage {
    type: "resize";
    cols: number;
    rows: number;
}

export interface InputMessage {
    type: "input";
    data: string;
}

export interface RunMessage {
    type: "run";
}

export interface KillMessage {
    type: "kill";
}

export interface OutputMessage {
    type: "output";
    data: string;
}

export interface ExitMessage {
    type: "exit";
    code: number | null;
}

export interface RunErrorMessage {
    type: "run_error";
    message: string;
}

export type WsMessage =
    | ResizeMessage
    | InputMessage
    | RunMessage
    | KillMessage
    | OutputMessage
    | ExitMessage
    | RunErrorMessage;

export type ConfirmAction = "back" | "submit" | null;

export interface SubmissionResult {
    score: number;
    maxScore: number;
    percentage: number;
    results: { step: string; passed: boolean; details?: string }[];
}
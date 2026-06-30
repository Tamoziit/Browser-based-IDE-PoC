import type { OnChange } from "@monaco-editor/react";
import type { Socket } from "socket.io-client";
import type { ReactNode } from "react";

// ─── Lab / Editor ─────────────────────────────────────────────────────────────

export type LabType = "RO_EXEC" | "RWX";

export interface FileEntry {
    name: string;
    type: "file" | "dir";
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

// ─── WebSocket / Socket Message Shapes ────────────────────────────────────────

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

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthUser {
    _id: string;
    fullName: string;
    username: string;
    email: string;
    gender: string;
    mobileNo: string;
    token: string;
}

export interface AuthContextType {
    authUser: AuthUser | null;
    token: string | null;
}

export interface AuthProviderProps {
    children: ReactNode;
}

// ─── Socket ───────────────────────────────────────────────────────────────────

export interface SocketContextType {
    socket: Socket | null;
}

export interface SocketProviderProps {
    children: ReactNode;
}

// ─── Terminal (uses socket.io Socket) ─────────────────────────────────────────

export interface TerminalProps {
    sessionId: string;
    socket?: Socket | null;
}
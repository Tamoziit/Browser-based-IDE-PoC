import type { Document } from "mongoose";

export type LabType = "RO_EXEC" | "RWX";

export interface AdminToken {
    password: string;
}

export interface User {
    _id: Types.ObjectId;
    fullName: string;
    username: string;
    email: string;
    password: string;
    mobileNo?: string | null;
    profilePic?: string | null;
    gender?: "M" | "F" | "O" | null;
}

declare module "express" {
    export interface Request {
        user?: User;
    }
}

export interface ISession extends Document {
    sessionId: string;
    userId: string;
    labId: string;
    runtime: string;
    podName: string;
    pvcName: string;
    workspacePath: string;
    workspaceSnapshot?: string;
    labType: LabType;
    status: "RUNNING" | "STOPPED";
    createdAt: Date;
    endedAt?: Date;
}

export interface LabSession {
    sessionId: string;
    userId: string;
    labId: string;
    podName: string;
    pvcName: string;
    workspacePath: string;
    runtime: string;
    labType: LabType;
    lastActivity: number;
}

export interface LabCreationProps {
    labId: string;
    runtime?: string;
}

export interface SessionParams {
    sessionId: string;
}

export interface FileContentProps {
    path: string;
    content?: string;
}

// ── Socket.io message types ───────────────────────────────────────────────────
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

export interface EvaluationResult {
    score: number;
    maxScore: number;
    percentage: number;
    results: {
        step: string;
        passed: boolean;
        details?: string;
    }[];
}

export interface TerminalState {
    session: LabSession;
    stdinStream: PassThrough;
    stdoutStream: PassThrough;
    execWebSocket: any;
    runExecWs: any;
    runTimeout: ReturnType<typeof setTimeout> | null;
    lineBuffer: string;
    trackedCwd: string;
    previousCwd: string;
}
import type { Document } from "mongoose";

export type LabType = "RO_EXEC" | "RWX";

export interface ISession extends Document {
    sessionId: string;
    userId: string;
    labId: string;
    runtime: string;
    containerId: string;
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
    containerId: string;
    workspacePath: string;
    runtime: string;
    labType: LabType;
    lastActivity: number;
}

export interface LabCreationProps {
    userId: string;
    labId: string;
    runtime?: string;
    labType?: LabType;
}

export interface SessionParams {
    sessionId: string;
}

export interface FileContentProps {
    path: string;
    content?: string;
}

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
import type { Document } from "mongoose";

export interface ISession extends Document {
    sessionId: string;
    userId: string;
    labId: string;
    runtime: string;
    containerId: string;
    workspacePath: string;
    workspaceSnapshot?: string;
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
    lastActivity: number;
}

export interface LabCreationProps {
    userId: string;
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

export interface ResizeMessage {
    type: "resize";
    cols: number;
    rows: number;
}

export interface InputMessage {
    type: "input";
    data: string;
}

export type WsMessage = ResizeMessage | InputMessage;
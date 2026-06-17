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
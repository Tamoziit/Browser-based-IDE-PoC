import mongoose from "mongoose";
import type { ISession } from "../types/index.d.ts";

const SessionSchema = new mongoose.Schema<ISession>({
    sessionId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    userId: {
        type: String,
        required: true
    },
    labId: {
        type: String,
        required: true
    },
    runtime: {
        type: String,
        required: true
    },
    containerId: {
        type: String,
        required: true
    },
    workspacePath: {
        type: String,
        required: true
    },
    workspaceSnapshot: {
        type: String
    },
    status: {
        type: String,
        enum: ["RUNNING", "STOPPED"],
        default: "RUNNING"
    },
    endedAt: {
        type: Date
    }
}, { timestamps: true });

const Session = mongoose.model<ISession>("Session", SessionSchema);
export default Session;
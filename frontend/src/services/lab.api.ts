import type { FileEntry, LabType } from "../interfaces";

const BASE = "/api";

export const labApi = {
    async startLab(userId: string, labId: string, labType: LabType, runtime = "python"): Promise<{ sessionId: string; labType: LabType }> {
        const res = await fetch(`${BASE}/labs/start`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId, labId, runtime, labType }),
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },


    async stopLab(sessionId: string): Promise<void> {
        await fetch(`${BASE}/labs/${sessionId}`, { method: "DELETE" });
    },

    async listFiles(sessionId: string): Promise<FileEntry[]> {
        const res = await fetch(`${BASE}/files?session=${sessionId}`);
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },

    async readFile(sessionId: string, filePath: string): Promise<{ content: string }> {
        const res = await fetch(`${BASE}/file?session=${sessionId}&path=${encodeURIComponent(filePath)}`);
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },

    async saveFile(sessionId: string, filePath: string, content: string): Promise<void> {
        const res = await fetch(`${BASE}/file?session=${sessionId}&path=${encodeURIComponent(filePath)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content }),
        });
        if (!res.ok) throw new Error(await res.text());
    },

    async createFile(sessionId: string, filePath: string, content = ""): Promise<void> {
        const res = await fetch(`${BASE}/file?session=${sessionId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: filePath, content }),
        });
        if (!res.ok) throw new Error(await res.text());
    },

    async deleteFile(sessionId: string, filePath: string): Promise<void> {
        await fetch(`${BASE}/file?session=${sessionId}&path=${encodeURIComponent(filePath)}`, {
            method: "DELETE",
        });
    },

    async runCode(sessionId: string): Promise<{ output: string }> {
        const res = await fetch(`${BASE}/labs/${sessionId}/run`, { method: "POST" });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },

    async submitLab(sessionId: string): Promise<{ score: number, maxScore: number, percentage: number, results: { step: string, passed: boolean, details?: string }[] }> {
        const res = await fetch(`${BASE}/labs/${sessionId}/submit`, { method: "POST" });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },
};
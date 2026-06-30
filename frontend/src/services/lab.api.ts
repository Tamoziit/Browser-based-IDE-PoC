import type { FileEntry, LabType } from "../interfaces";

// ─── Hardcoded Lab IDs (per lab type) ─────────────────────────────────────────
const LAB_IDS: Record<LabType, string> = {
    RWX: "6a1ee6d349413c0cf171e7e2",
    RO_EXEC: "6a1ee6d349413c0cf171e7e1",
};

// ─── Base URL ──────────────────────────────────────────────────────────────────
// VITE_API_BASE_URL must be set in .env (e.g. http://localhost:3001)
const API_BASE = import.meta.env.VITE_API_BASE_URL as string;
const BASE = `${API_BASE}/api/v1`;

// ─── Auth Header ──────────────────────────────────────────────────────────────
// Token is pre-stored in localStorage by the trusted auth module
const DN_TOKEN_KEY = "DN-token";

const getAuthHeader = (): Record<string, string> => {
    const token = localStorage.getItem(DN_TOKEN_KEY);
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
};

// ─── API ──────────────────────────────────────────────────────────────────────

export const labApi = {
    /**
     * Start a new lab session.
     * userId is derived server-side from the Bearer token via auth middleware.
     */
    async startLab(labType: LabType, runtime = "python"): Promise<{ sessionId: string; labType: LabType }> {
        const labId = LAB_IDS[labType];
        const res = await fetch(`${BASE}/labs/start`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...getAuthHeader(),
            },
            body: JSON.stringify({ labId, runtime }),
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },

    async getLabSession(sessionId: string): Promise<any> {
        const res = await fetch(`${BASE}/labs/${sessionId}`, {
            method: "GET",
            headers: getAuthHeader(),
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },

    async runLab(sessionId: string): Promise<{ output: string }> {
        const res = await fetch(`${BASE}/labs/${sessionId}/run`, {
            method: "POST",
            headers: getAuthHeader(),
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },

    async stopLab(sessionId: string): Promise<void> {
        await fetch(`${BASE}/labs/${sessionId}`, {
            method: "DELETE",
            headers: getAuthHeader(),
        });
    },

    async listFiles(sessionId: string): Promise<FileEntry[]> {
        const res = await fetch(`${BASE}/files?session=${sessionId}`, {
            headers: getAuthHeader(),
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },

    async readFile(sessionId: string, filePath: string): Promise<{ content: string }> {
        const res = await fetch(
            `${BASE}/files/file?session=${sessionId}&path=${encodeURIComponent(filePath)}`,
            { headers: getAuthHeader() }
        );
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },

    async saveFile(sessionId: string, filePath: string, content: string): Promise<void> {
        const res = await fetch(`${BASE}/files/file/update?session=${sessionId}&path=${encodeURIComponent(filePath)}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                ...getAuthHeader(),
            },
            body: JSON.stringify({ content }),
        });
        if (!res.ok) throw new Error(await res.text());
    },

    async createFile(sessionId: string, filePath: string, content = ""): Promise<void> {
        const res = await fetch(`${BASE}/files/file/create?session=${sessionId}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...getAuthHeader(),
            },
            body: JSON.stringify({ path: filePath, content }),
        });
        if (!res.ok) throw new Error(await res.text());
    },

    async deleteFile(sessionId: string, filePath: string): Promise<void> {
        const res = await fetch(`${BASE}/files/file/delete?session=${sessionId}&path=${encodeURIComponent(filePath)}`, {
            method: "DELETE",
            headers: getAuthHeader(),
        });
        if (!res.ok) throw new Error(await res.text());
    },

    async submitLab(sessionId: string): Promise<{ score: number; maxScore: number; percentage: number; results: { step: string; passed: boolean; details?: string }[] }> {
        const res = await fetch(`${BASE}/labs/submit/${sessionId}`, {
            method: "POST",
            headers: getAuthHeader(),
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },
};
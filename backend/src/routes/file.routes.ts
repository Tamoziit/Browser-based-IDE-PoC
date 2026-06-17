import express, { type Request, type Response } from "express";
import path from "path";
import fs from "fs/promises";
import { getSession, refreshSession } from "../services/docker.service.js";
import type { FileContentProps } from "../types/index.d.ts";

const router = express.Router();

// Guard: resolve path and ensure it stays inside the workspace
function safePath(workspacePath: string, filePath: string): string {
    const resolved = path.resolve(workspacePath, filePath);
    if (!resolved.startsWith(workspacePath + path.sep) && resolved !== workspacePath) {
        throw new Error("Path traversal rejected");
    }
    return resolved;
}

async function resolveSessionOrFail(
    sessionId: string | undefined,
    res: Response
): Promise<{ workspacePath: string; sessionId: string } | null> {
    if (!sessionId) {
        res.status(400).json({ error: "Missing session query param" });
        return null;
    }
    const session = await getSession(sessionId);
    if (!session) {
        res.status(404).json({ error: "Session not found or expired" });
        return null;
    }
    return { workspacePath: session.workspacePath, sessionId };
}

// GET /api/files?session=<id>
router.get("/files", async (req: Request, res: Response) => {
    const ctx = await resolveSessionOrFail(req.query.session as string, res);
    if (!ctx) return;

    try {
        const entries = await fs.readdir(ctx.workspacePath, { withFileTypes: true });
        res.status(200).json(
            entries.map((e) => ({
                name: e.name,
                type: e.isDirectory() ? "dir" : "file",
            }))
        );
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/file?session=<id>&path=main.py
router.get("/file", async (req: Request, res: Response) => {
    const ctx = await resolveSessionOrFail(req.query.session as string, res);
    if (!ctx) return;

    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: "Missing path param" });

    try {
        const fullPath = safePath(ctx.workspacePath, filePath);
        const content = await fs.readFile(fullPath, "utf8");
        await refreshSession(ctx.sessionId);

        res.status(200).json({ content });
    } catch (err: any) {
        res.status(err.message.includes("traversal") ? 403 : 404).json({ error: err.message });
    }
});

// PUT /api/file?session=<id>&path=main.py  body: { content }
router.put("/file", async (req: Request, res: Response) => {
    const ctx = await resolveSessionOrFail(req.query.session as string, res);
    if (!ctx) return;

    const filePath = req.query.path as string;
    const { content } = req.body as { content: string };

    if (!filePath || content === undefined) {
        return res.status(400).json({ error: "Missing path or content" });
    }

    try {
        const fullPath = safePath(ctx.workspacePath, filePath);
        await fs.writeFile(fullPath, content, "utf8");
        await refreshSession(ctx.sessionId);

        res.status(200).json({ ok: true });
    } catch (err: any) {
        res.status(err.message.includes("traversal") ? 403 : 500).json({ error: err.message });
    }
});

// POST /api/file?session=<id>  body: { path, content? }
router.post("/file", async (req: Request, res: Response) => {
    const ctx = await resolveSessionOrFail(req.query.session as string, res);
    if (!ctx) return;

    const {
        path: filePath,
        content = ""
    }: FileContentProps = req.body;
    if (!filePath) return res.status(400).json({ error: "Missing path in body" });

    try {
        const fullPath = safePath(ctx.workspacePath, filePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content, "utf8");

        res.status(201).json({ ok: true });
    } catch (err: any) {
        res.status(err.message.includes("traversal") ? 403 : 500).json({ error: err.message });
    }
});

// DELETE /api/file?session=<id>&path=notes.txt
router.delete("/file", async (req: Request, res: Response) => {
    const ctx = await resolveSessionOrFail(req.query.session as string, res);
    if (!ctx) return;

    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: "Missing path" });

    try {
        const fullPath = safePath(ctx.workspacePath, filePath);
        await fs.unlink(fullPath);

        res.status(200).json({ ok: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
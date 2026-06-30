import { Request, Response } from "express";
import { execInPod, resolveSession, safePodPath, writeFileToPod } from "../utils/fileHandlerUtils";
import { refreshSession } from "../services/k8s.service";
import { FileContentProps } from "../types";

export const getFileStructure = async (req: Request, res: Response) => {
    try {
        const session = await resolveSession(req.query.session as string, res);
        if (!session) {
            res.status(400).json({ error: "Error in resolving session data" });
            return;
        }

        const raw = await execInPod(session.podName, [
            "sh", "-c",
            `ls -1p '${session.workspacePath}' 2>/dev/null || echo ""`
        ]);

        const entries = raw
            .split("\n")
            .filter(Boolean)
            .map(name => ({
                name: name.replace(/\/$/, ""),
                type: name.endsWith("/") ? "dir" : "file",
            }));

        res.status(200).json(entries);
    } catch (error) {
        console.log("Error in getFileStructure controller", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
}

export const getFileByPath = async (req: Request, res: Response) => {
    try {
        const session = await resolveSession(req.query.session as string, res);
        if (!session) {
            res.status(400).json({ error: "Error in resolving session data" });
            return;
        }

        const filePath = req.query.path as string;

        if (!filePath) {
            res.status(400).json({ error: "Missing path param" });
            return;
        }

        const absPath = safePodPath(session.workspacePath, filePath);

        const content = await execInPod(session.podName, ["cat", absPath]);
        await refreshSession(session.sessionId);

        res.status(200).json({ content });
    } catch (error: any) {
        const status = error.message.includes("traversal") ? 403 : 404;
        console.log("Error in getFileByPath controller", error);
        res.status(status).json({ error: "Internal Server Error" });
    }
}

export const updateFile = async (req: Request, res: Response) => {
    try {
        const session = await resolveSession(req.query.session as string, res);
        if (!session) {
            res.status(400).json({ error: "Error in resolving session data" });
            return;
        }

        const filePath = req.query.path as string;
        const { content } = req.body as { content: string };

        if (!filePath || content === undefined) {
            res.status(400).json({ error: "Missing path or content" });
            return;
        }

        const absPath = safePodPath(session.workspacePath, filePath);

        await writeFileToPod(session.podName, absPath, content);
        await refreshSession(session.sessionId);

        res.status(200).json({ ok: true });
    } catch (error: any) {
        const status = error.message.includes("traversal") ? 403 : 404;
        console.log("Error in updateFile controller", error);
        res.status(status).json({ error: "Internal Server Error" });
    }
}

export const createFile = async (req: Request, res: Response) => {
    try {
        const session = await resolveSession(req.query.session as string, res);
        if (!session) {
            res.status(400).json({ error: "Error in resolving session data" });
            return;
        }

        const { path: filePath, content = "" }: FileContentProps = req.body;

        if (!filePath) {
            res.status(400).json({ error: "Missing path in body" });
            return;
        }

        const absPath = safePodPath(session.workspacePath, filePath);

        await writeFileToPod(session.podName, absPath, content);
        await refreshSession(session.sessionId);

        res.status(201).json({ ok: true });
    } catch (error: any) {
        const status = error.message.includes("traversal") ? 403 : 404;
        console.log("Error in createFile controller", error);
        res.status(status).json({ error: "Internal Server Error" });
    }
}

export const deleteFile = async (req: Request, res: Response) => {
    try {
        const session = await resolveSession(req.query.session as string, res);
        if (!session) {
            res.status(400).json({ error: "Error in resolving session data" });
            return;
        }

        const filePath = req.query.path as string;

        if (!filePath) {
            res.status(400).json({ error: "Missing path param" });
            return;
        }

        const absPath = safePodPath(session.workspacePath, filePath);

        await execInPod(session.podName, ["rm", "-f", absPath]);
        await refreshSession(session.sessionId);

        res.status(200).json({ ok: true });
    } catch (error: any) {
        const status = error.message.includes("traversal") ? 403 : 404;
        console.log("Error in deleteFile controller", error);
        res.status(status).json({ error: "Internal Server Error" });
    }
}
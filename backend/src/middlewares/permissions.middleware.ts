import type { Request, Response, NextFunction } from "express";
import path from "path";
import { getSession } from "../services/k8s.service";

function extractSessionId(req: Request): string | undefined {
    return (req.query.session as string | undefined) ?? req.body?.sessionId;
}

function extractFilePath(req: Request): string | undefined {
    return (req.query.path as string | undefined) ?? req.body?.path;
}

export const blockDownload = (_req: Request, res: Response, _next: NextFunction): void => {
    res.status(403).json({ error: "File downloads are not permitted in this environment." });
};

export const enforceWritePermission = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const sessionId = extractSessionId(req);
    if (!sessionId) {
        res.status(400).json({ error: "Missing session query param" });
        return;
    }

    const session = await getSession(sessionId);
    if (!session) {
        res.status(404).json({ error: "Session not found or expired" });
        return;
    }

    if (session.labType === "RO_EXEC") {
        const basename = path.basename(extractFilePath(req) ?? "");
        if (basename !== ".env") {
            res.status(403).json({ error: "Write access restricted in RO_EXEC. Only .env may be modified." });
            return;
        }
    }

    next();
};

export const enforceCreatePermission = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const sessionId = extractSessionId(req);
    if (!sessionId) {
        res.status(400).json({ error: "Missing session query param" });
        return;
    }

    const session = await getSession(sessionId);
    if (!session) {
        res.status(404).json({ error: "Session not found or expired" });
        return;
    }

    if (session.labType === "RO_EXEC") {
        res.status(403).json({ error: "File creation is restricted in RO_EXEC labs." });
        return;
    }

    next();
};

export const enforceDeletePermission = async (
    req: Request, res: Response, next: NextFunction
): Promise<void> => {
    const sessionId = extractSessionId(req);
    if (!sessionId) {
        res.status(400).json({ error: "Missing session query param" });
        return;
    }

    const session = await getSession(sessionId);
    if (!session) {
        res.status(404).json({ error: "Session not found or expired" });
        return;
    }

    if (session.labType === "RO_EXEC") {
        res.status(403).json({ error: "File deletion is restricted in RO_EXEC labs." });
        return;
    }

    next();
};

export const enforceExportPermission = async (
    req: Request, res: Response, next: NextFunction
): Promise<void> => {
    if (req.query.purpose !== "export") {
        next();
        return;
    }

    const sessionId = extractSessionId(req);
    if (!sessionId) {
        res.status(400).json({ error: "Missing session query param" });
        return;
    }

    const session = await getSession(sessionId);
    if (!session) {
        res.status(404).json({ error: "Session not found or expired" });
        return;
    }

    if (session.labType === "RO_EXEC") {
        res.status(403).json({ error: "Export is restricted in RO_EXEC labs." });
        return;
    }

    next();
};

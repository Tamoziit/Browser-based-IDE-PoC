import type { Request, Response, NextFunction } from "express";
import path from "path";
import { getSession } from "../services/docker.service.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the sessionId from the request.
 * Checks query param first (GET/PUT/DELETE), then JSON body (POST).
 */
function extractSessionId(req: Request): string | undefined {
    return (req.query.session as string | undefined) ?? req.body?.sessionId;
}

/**
 * Resolve the target file path from the request.
 * Checks query param first, then JSON body.
 */
function extractFilePath(req: Request): string | undefined {
    return (req.query.path as string | undefined) ?? req.body?.path;
}

// ─────────────────────────────────────────────────────────────────────────────
// Guard: block all file downloads (applies to ALL lab types)
// ─────────────────────────────────────────────────────────────────────────────

export const blockDownload = (_req: Request, res: Response, _next: NextFunction): void => {
    res.status(403).json({
        error: "File downloads are not permitted in this environment."
    });
};

// ─────────────────────────────────────────────────────────────────────────────
// Guard: block file writes for RO_EXEC labs (except .env)
// PUT /api/file
// ─────────────────────────────────────────────────────────────────────────────

export const enforceWritePermission = async (
    req: Request,
    res: Response,
    next: NextFunction
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
        const filePath = extractFilePath(req) ?? "";
        const basename = path.basename(filePath);

        // Only .env is writable in RO_EXEC labs
        if (basename !== ".env") {
            console.warn(
                `[Permissions] BLOCKED write to "${filePath}" — session=${sessionId} labType=RO_EXEC`
            );
            res.status(403).json({
                error: "Write access is restricted in Read-Only & Execute labs. Only .env may be modified."
            });
            return;
        }
    }

    next();
};

// ─────────────────────────────────────────────────────────────────────────────
// Guard: block file creation for RO_EXEC labs
// POST /api/file
// ─────────────────────────────────────────────────────────────────────────────

export const enforceCreatePermission = async (
    req: Request,
    res: Response,
    next: NextFunction
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
        const filePath = extractFilePath(req) ?? "";
        console.warn(
            `[Permissions] BLOCKED create "${filePath}" — session=${sessionId} labType=RO_EXEC`
        );
        res.status(403).json({
            error: "File creation is restricted in Read-Only & Execute labs."
        });
        return;
    }

    next();
};

// ─────────────────────────────────────────────────────────────────────────────
// Guard: block file deletion for RO_EXEC labs
// DELETE /api/file
// ─────────────────────────────────────────────────────────────────────────────

export const enforceDeletePermission = async (
    req: Request,
    res: Response,
    next: NextFunction
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
        const filePath = extractFilePath(req) ?? "";
        console.warn(
            `[Permissions] BLOCKED delete "${filePath}" — session=${sessionId} labType=RO_EXEC`
        );
        res.status(403).json({
            error: "File deletion is restricted in Read-Only & Execute labs."
        });
        return;
    }

    next();
};

// ─────────────────────────────────────────────────────────────────────────────
// Guard: block export/copy-for-export for RO_EXEC labs
// GET /api/file?purpose=export
// ─────────────────────────────────────────────────────────────────────────────

export const enforceExportPermission = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    const purpose = req.query.purpose as string | undefined;
    if (purpose !== "export") {
        // Normal file read — always allowed; proceed to handler
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
        const filePath = extractFilePath(req) ?? "";
        console.warn(
            `[Permissions] BLOCKED export "${filePath}" — session=${sessionId} labType=RO_EXEC`
        );
        res.status(403).json({
            error: "File export is restricted in Read-Only & Execute labs."
        });
        return;
    }

    next();
};

import express, { type Request, type Response } from "express";
import type { LabCreationProps, SessionParams } from "../types/index.d.ts";
import { getSession, runCode, startLab, stopLab } from "../services/docker.service.js";
import { evaluateLab } from "../services/evaluation.service.js";
import { blockDownload } from "../middleware/permissions.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/labs/start  { userId, labId, runtime?, labType? }
// ─────────────────────────────────────────────────────────────────────────────
router.post(
    "/labs/start",
    async (
        req: Request,
        res: Response
    ) => {
        const {
            userId,
            labId,
            runtime = "python",
            labType = "RWX"
        }: LabCreationProps = req.body;

        if (!userId || !labId) {
            res.status(400).json({ error: "userId and labId are required" });
            return;
        }

        // Validate labType value
        if (labType !== "RO_EXEC" && labType !== "RWX") {
            res.status(400).json({ error: "labType must be 'RO_EXEC' or 'RWX'" });
            return;
        }

        try {
            const sessionId = await startLab(userId, labId, runtime, labType);
            res.status(201).json({ sessionId, labType });
        } catch (error: any) {
            console.error("[Route] startLab error:", error);
            res.status(500).json({ error: error.message });
        }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/labs/:sessionId
// ─────────────────────────────────────────────────────────────────────────────
router.get(
    "/labs/:sessionId",
    async (
        req: Request<SessionParams>,
        res: Response
    ) => {
        const session = await getSession(req.params.sessionId);

        if (!session) {
            res.status(404).json({ error: "Session not found" });
            return;
        }

        return res.status(200).json(session);
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/labs/:sessionId/run
// ─────────────────────────────────────────────────────────────────────────────
router.post(
    "/labs/:sessionId/run",
    async (
        req: Request<SessionParams>,
        res: Response
    ) => {
        try {
            const output = await runCode(req.params.sessionId);

            if (!output) {
                res.status(404).json({ error: "Error in producing output" });
                return;
            }

            res.status(200).json({ output });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/labs/:sessionId
// ─────────────────────────────────────────────────────────────────────────────
router.delete(
    "/labs/:sessionId",
    async (
        req: Request<SessionParams>,
        res: Response
    ) => {
        await stopLab(req.params.sessionId);
        res.status(200).json({ ok: true });
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/labs/:sessionId/submit
// ─────────────────────────────────────────────────────────────────────────────
router.post(
    "/labs/:sessionId/submit",
    async (
        req: Request<SessionParams>,
        res: Response
    ) => {
        try {
            const result = await evaluateLab(req.params.sessionId);
            
            // End the lab and cleanup resources immediately after evaluating
            await stopLab(req.params.sessionId);

            res.status(200).json(result);
        } catch (error: any) {
            console.error("[Route] submitLab error:", error);
            res.status(500).json({ error: error.message });
        }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/labs/export/*  →  403 for ALL lab types
// Catch-all export/archive download attempt via the labs namespace
// ─────────────────────────────────────────────────────────────────────────────
router.get("/labs/export/*", blockDownload);
router.post("/labs/export/*", blockDownload);

export default router;
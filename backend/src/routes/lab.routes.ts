import express, { type Request, type Response } from "express";
import type { LabCreationProps, SessionParams } from "../types/index.d.ts";
import { getSession, runCode, startLab, stopLab } from "../services/docker.service.js";

const router = express.Router();

// POST /api/labs/start  { userId, labId, runtime? }
router.post(
    "/labs/start",
    async (
        req: Request,
        res: Response
    ) => {
        const {
            userId,
            labId,
            runtime = "python"
        }: LabCreationProps = req.body;

        if (!userId || !labId) {
            res.status(400).json({ error: "userId and labId are required" });
        }

        try {
            const sessionId = await startLab(userId, labId, runtime);
            res.status(201).json({ sessionId });
        } catch (error: any) {
            console.error("[Route] startLab error:", error);
            res.status(500).json({ error: error.message });
        }
    }
);

// GET /api/labs/:sessionId
router.get(
    "/labs/:sessionId",
    async (
        req: Request<SessionParams>,
        res: Response
    ) => {
        const session = await getSession(req.params.sessionId);

        if (!session) {
            res.status(404).json({ error: "Session not found" });
        }

        return res.status(200).json(session);
    }
);

// POST /api/labs/:sessionId/run
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
            }

            res.status(200).json({ output });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }
);

// DELETE /api/labs/:sessionId
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

export default router;
import { Request, Response } from "express";
import type { LabCreationProps } from "../types";
import CourseChapter from "../models/course-chapter.model";
import { getSession, runCode, startLab, stopLab } from "../services/k8s.service";
import { evaluateLab } from "../services/evaluation.service";

export const createLabSession = async (req: Request, res: Response) => {
    try {
        const userId = req.user?._id.toString();
        if (!userId) {
            res.status(401).json({ error: "Unauthorized — missing userId" });
            return;
        }

        const { labId, runtime = "python" }: LabCreationProps = req.body;
        if (!labId) {
            res.status(400).json({ error: "labId is required" });
            return;
        }

        const chapter = await CourseChapter.findById(labId).lean();

        if (!chapter) {
            res.status(400).json({ error: "Chapter not found" });
            return;
        }
        if (!chapter.isLab) {
            res.status(400).json({ error: "This chapter is not a lab" });
            return;
        }
        if (!chapter.labType) {
            res.status(400).json({ error: "Chapter has no labType configured" });
            return;
        }

        const sessionId = await startLab(
            userId,
            labId,
            runtime,
            chapter.labType
        );

        if (sessionId) {
            res.status(201).json({
                sessionId,
                labType: chapter.labType
            });
        } else {
            res.status(400).json({ error: "Error in creating Lab Session" });
        }
    } catch (error) {
        console.log("Error in createLabSession controller", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
}

export const getSessionById = async (req: Request, res: Response) => {
    try {
        const sessionId = req.params.sessionId as string;
        const session = await getSession(sessionId);
        if (!session) {
            res.status(400).json({ error: "Session not found" });
            return;
        }

        res.status(200).json(session);
    } catch (error) {
        console.log("Error in getSessionById controller", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
}

export const runLabSession = async (req: Request, res: Response) => {
    try {
        const sessionId = req.params.sessionId as string;
        const output = await runCode(sessionId);
        if (!output) {
            res.status(400).json({ error: "Error in generating output" });
            return;
        }

        res.status(200).json({ output });
    } catch (error) {
        console.log("Error in runLabSession controller", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
}

export const deleteSessionById = async (req: Request, res: Response) => {
    try {
        const sessionId = req.params.sessionId as string;
        await stopLab(sessionId);
        res.status(200).json({ ok: true });
    } catch (error) {
        console.log("Error in deleteSessionById controller", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
}

export const submitLab = async (req: Request, res: Response) => {
    try {
        const sessionId = req.params.sessionId as string;
        const result = await evaluateLab(sessionId);
        if (!result) {
            res.status(400).json({ error: "Error in submitting the lab" });
            return;
        }

        await stopLab(sessionId);

        res.status(200).json(result);
    } catch (error) {
        console.log("Error in submitLab controller", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
}
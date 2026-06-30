import express from "express";
import { createLabSession, deleteSessionById, getSessionById, runLabSession, submitLab } from "../controllers/lab.controller";
import verifyToken from "../middlewares/auth.middleware";
import { blockDownload } from "../middlewares/permissions.middleware";

const router = express.Router();

router.post("/start", verifyToken, createLabSession);
router.get("/:sessionId", verifyToken, getSessionById);
router.post("/:sessionId/run", verifyToken, runLabSession);
router.delete("/:sessionId", verifyToken, deleteSessionById);
router.post("/submit/:sessionId", verifyToken, submitLab);
router.get("/export/*path", blockDownload);
router.post("/export/*path", blockDownload);

export default router;
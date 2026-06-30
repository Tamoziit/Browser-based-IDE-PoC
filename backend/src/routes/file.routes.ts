import express from "express";
import verifyToken from "../middlewares/auth.middleware";
import { createFile, deleteFile, getFileByPath, getFileStructure, updateFile } from "../controllers/file.controller";
import { blockDownload, enforceCreatePermission, enforceDeletePermission, enforceExportPermission, enforceWritePermission } from "../middlewares/permissions.middleware";

const router = express.Router();

router.get("/", verifyToken, getFileStructure);
router.get("/file", verifyToken, enforceExportPermission, getFileByPath);
router.put("/file/update", verifyToken, enforceWritePermission, updateFile);
router.post("/file/create", verifyToken, enforceCreatePermission, createFile);
router.delete("/file/delete", verifyToken, enforceDeletePermission, deleteFile);
router.get("/file/download", blockDownload);
router.get("/export/*path", blockDownload);
router.post("/export/*path", blockDownload);

export default router;
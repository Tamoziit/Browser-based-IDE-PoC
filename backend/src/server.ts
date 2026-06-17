import dotenv from "dotenv";
dotenv.config();
import express from "express";
import { createServer } from "http";
import cors from "cors";
import labRoutes from "./routes/lab.routes.js";
import fileRoutes from "./routes/file.routes.js";
import initTerminalWS from "./ws/terminal.ws.js";
import { connectToMongoDB } from "./config/mongodb.js";
import { startCleanupWorker } from "./workers/cleanup.worker.js";
import { startSnapshotCron } from "./workers/snapshot.cron.js";

const app = express();
const httpServer = createServer(app);

app.use(cors(
    {
        origin: "*"
    }
));
app.use(express.json({ limit: "5mb" }));

app.use("/api", labRoutes);
app.use("/api", fileRoutes);
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

initTerminalWS(httpServer);

const bootstrap = async () => {
    await connectToMongoDB();
    await startCleanupWorker();
    startSnapshotCron();

    const PORT = parseInt(process.env.PORT ?? "3001", 10);
    httpServer.listen(PORT, () => {
        console.log(`[Server] Listening on http://localhost:${PORT}`);
    });
}

bootstrap().catch((error) => {
    console.error("[Bootstrap] Fatal error:", error);
    process.exit(1);
});
import { spawn } from "child_process";
import path from "path";
import cron from "node-cron";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import Session from "../models/session.model.js";

export function startSnapshotCron(): void {
    const snapshotsDir = path.resolve(process.env.SNAPSHOTS_DIR ?? "./snapshots");

    cron.schedule("*/5 * * * *", async () => {
        // Top-level catch — node-cron silently swallows unhandled rejections,
        // so we always log failures explicitly.
        try {
            console.log("[Snapshot] Running scheduled workspace snapshot...");

            await fs.mkdir(snapshotsDir, { recursive: true });

            const activeSessions = await Session.find({ status: "RUNNING" });

            if (activeSessions.length === 0) {
                console.log("[Snapshot] No active sessions — nothing to snapshot.");
                return;
            }

            for (const record of activeSessions) {
                const snapshotPath = path.join(snapshotsDir, `${record.sessionId}.tar.gz`);

                try {
                    // Use `docker cp` to stream /workspace out of the running container.
                    // This works regardless of whether the backend itself is containerised,
                    // because we only need access to the Docker socket — not the host path.
                    //
                    // `docker cp <id>:/workspace/. -` writes a tar stream to stdout;
                    // we pipe it straight to disk as the snapshot archive.
                    await new Promise<void>((resolve, reject) => {
                        const dockerCp = spawn("docker", [
                            "cp",
                            `${record.containerId}:/workspace/.`,
                            "-",   // stream tar to stdout
                        ]);

                        const out = createWriteStream(snapshotPath);
                        dockerCp.stdout.pipe(out);

                        let stderr = "";
                        dockerCp.stderr.on("data", (chunk: Buffer) => {
                            stderr += chunk.toString();
                        });

                        dockerCp.on("close", (code) => {
                            if (code === 0) {
                                resolve();
                            } else {
                                reject(new Error(`docker cp exited ${code}: ${stderr.trim()}`));
                            }
                        });

                        dockerCp.on("error", reject);
                    });

                    await Session.updateOne(
                        { sessionId: record.sessionId },
                        { $set: { workspaceSnapshot: snapshotPath } }
                    );

                    console.log(`[Snapshot] OK: ${record.sessionId} → ${snapshotPath}`);
                } catch (err) {
                    console.error(`[Snapshot] Failed for ${record.sessionId}:`, err);
                }
            }
        } catch (err) {
            console.error("[Snapshot] Cron job crashed:", err);
        }
    });

    console.log("[Snapshot] Cron scheduled (every 5 min)");
}

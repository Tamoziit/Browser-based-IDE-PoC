import { exec } from "child_process";
import path from "path";
import { promisify } from "util";
import cron from "node-cron";
import fs from "fs/promises";
import Session from "../models/session.model.js";

const execAsync = promisify(exec);

export function startSnapshotCron(): void {
    const snapshotsDir = path.resolve(process.env.SNAPSHOTS_DIR ?? "./snapshots");

    cron.schedule("*/5 * * * *", async () => {
        console.log("[Snapshot] Running scheduled workspace snapshot...");

        await fs.mkdir(snapshotsDir, { recursive: true });

        const activeSessions = await Session.find({ status: "RUNNING" });

        for (const record of activeSessions) {
            const snapshotPath = path.join(snapshotsDir, `${record.sessionId}.tar.gz`);

            try {
                // Creating a compressed archive of the workspace
                await execAsync(
                    `tar -czf "${snapshotPath}" -C "${record.workspacePath}" .`
                );

                await Session.updateOne(
                    { sessionId: record.sessionId },
                    { $set: { workspaceSnapshot: snapshotPath } }
                );

                console.log(`[Snapshot] OK: ${record.sessionId}`);
            } catch (err) {
                console.error(`[Snapshot] Failed for ${record.sessionId}:`, err);
            }
        }
    });

    console.log("[Snapshot] Cron scheduled (every 5 min)");
}
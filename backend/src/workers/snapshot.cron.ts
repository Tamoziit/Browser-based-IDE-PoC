import cron from "node-cron";
import Session from "../models/session.model";
import { getSession } from "../services/k8s.service";
import snapshotWorkspace from "../services/snapshot.service";
import pLimit from "p-limit";

let isRunning = false;

const startSnapshotCron = (): void => {
    cron.schedule("*/5 * * * *", async () => {
        if (isRunning) {
            console.log("[Snapshot] Skipping — previous run still in progress.");
            return;
        }
        isRunning = true;
        const cronStart = Date.now();

        try {
            const activeSessions = await Session.find({ status: "RUNNING" });
            if (activeSessions.length === 0) {
                console.log("[Snapshot] No active sessions.");
                return;
            }

            console.log(`[Snapshot] Snapshotting ${activeSessions.length} session(s)...`);

            const limit = pLimit(5);  // 5 concurrent tar+upload streams
            await Promise.all(
                activeSessions.map((record) =>
                    limit(async () => {
                        const session = await getSession(record.sessionId);
                        if (!session) return;
                        const t = Date.now();
                        try {
                            await snapshotWorkspace(session);
                            console.log(`[Snapshot] ${record.sessionId} done in ${Date.now() - t}ms`);
                        } catch (err) {
                            console.error(`[Snapshot] Failed for ${record.sessionId}:`, err);
                        }
                    })
                )
            );
        } catch (err) {
            console.error("[Snapshot] Cron crashed:", err);
        } finally {
            console.log(`[Snapshot] Cron tick finished in ${Date.now() - cronStart}ms`);
            isRunning = false;
        }
    });

    console.log("[Snapshot] Cron scheduled (every 5 min)");
};

export default startSnapshotCron;
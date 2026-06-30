import { redis } from "../config/redis";
import Session from "../models/session.model";
import { destroyPod } from "../services/k8s.service";

export const EXPIRED_KEY_CHANNEL = "__keyevent@0__:expired";
export const SESSION_KEY_PREFIX = "lab:session:";

// Recovery sweep — runs once on worker startup.
// Catches sessions whose Redis expiry event was missed (worker was down, lazy expiry delay, etc.)
export const recoverMissedSessions = async (): Promise<void> => {
    console.log("[Cleanup] Running missed-session recovery sweep...");

    const runningSessions = await Session.find({ status: "RUNNING" });
    if (runningSessions.length === 0) {
        console.log("[Cleanup] Recovery: no RUNNING sessions found.");
        return;
    }

    let recovered = 0;

    for (const record of runningSessions) {
        const key = `${SESSION_KEY_PREFIX}${record.sessionId}`;

        try {
            const ttl = await redis.ttl(key);

            // ttl === -2 → key doesn't exist (expired or never set)
            // ttl === -1 → key exists but has no expiry (shouldn't happen, but treat as orphan)
            if (ttl === -2 || ttl === -1) {
                console.log(`[Cleanup] Recovery: orphaned session found: ${record.sessionId} (ttl=${ttl})`);
                await finalizeSession(record.sessionId, record.podName, record.pvcName);
                recovered++;
            }
        } catch (error) {
            console.error(`[Cleanup] Recovery: error checking session ${record.sessionId}:`, error);
        }
    }

    console.log(`[Cleanup] Recovery sweep complete. Recovered ${recovered} session(s).`);
};

// Shared finalization — used by both the recovery sweep and the live expiry handler.
// Idempotent: safe to call twice on same session.
export const finalizeSession = async (
    sessionId: string,
    podName: string,
    pvcName: string
): Promise<void> => {
    try {
        await destroyPod(podName, pvcName);

        await Session.updateOne(
            { sessionId, status: "RUNNING" }, // guard: only update if still RUNNING
            { $set: { status: "STOPPED", endedAt: new Date() } }
        );

        console.log(`[Cleanup] Finalized session=${sessionId}`);
    } catch (error) {
        console.error(`[Cleanup] Failed to finalize session=${sessionId}:`, error);
        // Don't rethrow — one bad session shouldn't kill the worker
    }
};

// Live expiry handler — fires when Redis emits the keyevent for an expired key.
export const handleExpiredKey = async (key: string): Promise<void> => {
    if (!key.startsWith(SESSION_KEY_PREFIX)) return;

    const sessionId = key.replace(SESSION_KEY_PREFIX, "");
    console.log(`[Cleanup] Session expired: ${sessionId}`);

    const record = await Session.findOne({ sessionId, status: "RUNNING" });
    if (!record) {
        console.log(`[Cleanup] No RUNNING record for session=${sessionId}, skipping.`);
        return;
    }

    await finalizeSession(record.sessionId, record.podName, record.pvcName);
};

import { Redis } from "ioredis";
import Session from "../models/session.model.js";
import { destroyContainer } from "../services/docker.service.js";

// IMPORTANT: pub/sub requires a *dedicated* Redis connection.
// We cannot use the shared `redis` instance for subscribe().
const subscriber = new Redis(process.env.REDIS_URL!);

const EXPIRED_KEY_CHANNEL = "__keyevent@0__:expired";

export async function startCleanupWorker(): Promise<void> {
    // redis-server is started with --notify-keyspace-events Ex in docker-compose.
    // This programmatic SET is a belt-and-suspenders approach for cases where
    // the redis instance is not ours to configure.
    try {
        await subscriber.config("SET", "notify-keyspace-events", "Ex");
    } catch {
        // Redis in protected mode may not allow CONFIG — rely on the compose flag
        console.warn("[Cleanup] Could not set notify-keyspace-events via CONFIG — relying on server config");
    }

    await subscriber.subscribe(EXPIRED_KEY_CHANNEL);

    subscriber.on("message", async (channel: string, key: string) => {
        if (channel !== EXPIRED_KEY_CHANNEL) return;
        if (!key.startsWith("lab:session:")) return;

        const sessionId = key.replace("lab:session:", "");
        console.log(`[Cleanup] Session expired: ${sessionId}`);

        // At this point the Redis key is already gone — look up containerId from Mongo
        const record = await Session.findOne({ sessionId, status: "RUNNING" });
        if (!record) return;

        await destroyContainer(record.containerId);

        await Session.updateOne(
            { sessionId },
            { $set: { status: "STOPPED", endedAt: new Date() } }
        );

        console.log(`[Cleanup] Session ${sessionId} finalized`);
    });

    subscriber.on("error", (err) => {
        console.error("[Cleanup] Redis subscriber error:", err);
    });

    console.log("[Cleanup] Worker listening for expired keys");
}
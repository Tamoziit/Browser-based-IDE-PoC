import { Redis } from "ioredis";
import { EXPIRED_KEY_CHANNEL, handleExpiredKey, recoverMissedSessions } from "../utils/cleanupUtils";

const startCleanupWorker = async (): Promise<void> => {
    // recovering any sessions missed while worker was offline
    await recoverMissedSessions();

    // spinning up a dedicated subscriber connection
    // Redis requires a separate connection for pub/sub — a subscribed client can't issue regular commands.
    const subscriber = new Redis(process.env.REDIS_URL!, {
        lazyConnect: false,
        enableReadyCheck: true,
        retryStrategy: (times) => Math.min(times * 200, 3000),
    });

    subscriber.on("connect", () => console.log("[Cleanup] Subscriber connected"));
    subscriber.on("ready", () => console.log("[Cleanup] Subscriber ready"));
    subscriber.on("error", (err) => console.error("[Cleanup] Subscriber error:", err.message));
    subscriber.on("reconnecting", () => console.log("[Cleanup] Subscriber reconnecting..."));

    // Confirming the subscription actually registered
    subscriber.on("subscribe", (channel, count) => {
        console.log(`[Cleanup] Subscribed to '${channel}' (active subscriptions: ${count})`);
    });

    await subscriber.subscribe(EXPIRED_KEY_CHANNEL);

    subscriber.on("message", async (_channel: string, key: string) => {
        await handleExpiredKey(key);
    });

    console.log("[Cleanup] Worker listening for expired keys");
}

export default startCleanupWorker;
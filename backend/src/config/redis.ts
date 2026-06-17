import { Redis } from "ioredis";

export const redis = new Redis(process.env.REDIS_URL!, {
    lazyConnect: false,
    enableReadyCheck: true
});

redis.on("connect", () => console.log("[Redis] Connected"));
redis.on("error", (err: Error) => console.error("[Redis] Error:", err.message));

export const SESSION_TTL = 1800;
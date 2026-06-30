import dotenv from "dotenv";
dotenv.config();
import { Redis } from "ioredis";

const createRedisClient = (name: string): Redis => {
    const client = new Redis(process.env.REDIS_URL!, {
        lazyConnect: false,
        enableReadyCheck: true,
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
            if (times > 10) {
                console.error(`[Redis:${name}] Max retries reached, giving up`);
                return null; // stop retrying
            }
            
            return Math.min(times * 200, 2000); // exponential backoff, cap at 2s
        },
    });

    client.on("connect", () => console.log(`[Redis:${name}] Connected`));
    client.on("ready", () => console.log(`[Redis:${name}] Ready`));
    client.on("error", (err: Error) => console.error(`[Redis:${name}] Error:`, err.message));
    client.on("reconnecting", () => console.log(`[Redis:${name}] Reconnecting...`));
    client.on("close", () => console.log(`[Redis:${name}] Connection closed`));

    return client;
};

// Main client — for SET/GET/TTL operations
export const redis = createRedisClient("main");

export const SESSION_TTL = 1800; // 30 min
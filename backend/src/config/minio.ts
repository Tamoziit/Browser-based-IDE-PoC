import dotenv from "dotenv";
dotenv.config();
import { Client as MinioClient } from "minio";

export const minio = new MinioClient({
    endPoint: process.env.MINIO_ENDPOINT ?? "localhost",
    port: parseInt(process.env.MINIO_PORT ?? "9000", 10),
    useSSL: process.env.MINIO_USE_SSL === "true",
    accessKey: process.env.MINIO_ACCESS_KEY,
    secretKey: process.env.MINIO_SECRET_KEY,
});

export const BUCKET_TEMPLATES = process.env.MINIO_BUCKET_TEMPLATES ?? "nc-lms-templates";
export const BUCKET_SNAPSHOTS = process.env.MINIO_BUCKET_SNAPSHOTS ?? "nc-lms-snapshots";

export const ensureBucketsCreation = async (): Promise<void> => {
    for (const bucket of [BUCKET_TEMPLATES, BUCKET_SNAPSHOTS]) {
        const exists = await minio.bucketExists(bucket);

        if (!exists) {
            await minio.makeBucket(bucket);
            console.log(`[MinIO] Created bucket: ${bucket}`);
        }
    }

    console.log("[MinIO] Buckets ready");
}
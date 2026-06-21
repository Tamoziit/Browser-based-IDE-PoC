import Docker from "dockerode";
import { v4 as uuid } from "uuid";
import path from "path";
import fs from "fs/promises";
import type { LabSession, LabType } from "../types/index.d.ts";
import { redis, SESSION_TTL } from "../config/redis.js";
import Session from "../models/session.model.js";
import { PassThrough } from "stream";

const docker = new Docker({ socketPath: "/var/run/docker.sock" });

const RUNTIME_IMAGES: Record<string, string> = {
    python: "lms-python"
};

// Starting lab & creating execution env.
export const startLab = async (
    userId: string,
    labId: string,
    runtime: string = "python",
    labType: LabType = "RWX"
): Promise<string> => {
    // ── Idempotency Check ────────────────────────────────────────────────────
    // If a RUNNING session already exists for this user+lab combination, reuse it
    // instead of spawning a duplicate container. (Protects against concurrent calls)
    const existingSession = await Session.findOne({
        userId,
        labId,
        status: "RUNNING"
    });

    if (existingSession) {
        console.log(`[Lab] Reusing existing session=${existingSession.sessionId} labType=${labType} container=${existingSession.containerId.slice(0, 12)}`);
        return existingSession.sessionId;
    }

    const image = RUNTIME_IMAGES[runtime];
    if (!image) throw new Error(`Unknown runtime: ${runtime}`);

    const sessionId = uuid();

    // Absolute path required for Docker bind mount
    const workspacePath = path.resolve(
        process.env.WORKSPACES_DIR ?? "./workspaces",
        userId
    );

    await fs.mkdir(workspacePath, { recursive: true });

    // Seeding workspace with a starter file if empty
    const existing = await fs.readdir(workspacePath);
    if (existing.length == 0) {
        await fs.writeFile(
            path.join(workspacePath, "main.py"),
            '# Your Python lab\nprint("Hello from the lab!")\n',
            "utf8"
        );
    }

    // creating & starting container
    const container = await docker.createContainer({
        Image: image,
        Tty: true,
        OpenStdin: true,
        WorkingDir: "/workspace",
        HostConfig: {
            Binds: [
                labType === "RO_EXEC"
                    ? `${workspacePath}:/workspace:ro`
                    : `${workspacePath}:/workspace`
            ],
            AutoRemove: false,
            NetworkMode: "none",
            // RO_EXEC: make the entire container root FS read-only at the
            // kernel level.  /tmp is re-mounted as an in-memory tmpfs so
            // bash internal operations (history, completion) still work.
            ...(labType === "RO_EXEC" && {
                ReadonlyRootfs: true,
                Tmpfs: { "/tmp": "size=64m,mode=1777" },
            }),
        }
    });

    await container.start();

    // Persisting hot session in Redis
    const session: LabSession = {
        sessionId,
        userId,
        labId,
        containerId: container.id,
        workspacePath,
        runtime,
        labType,
        lastActivity: Date.now(),
    };

    await redis.set(
        `lab:session:${sessionId}`,
        JSON.stringify(session),
        "EX",
        SESSION_TTL
    );

    // Persisting cold record in Mongo
    await Session.create({
        sessionId,
        userId,
        labId,
        runtime,
        labType,
        containerId: container.id,
        workspacePath,
        status: "RUNNING",
    });

    console.log(`[Lab] Started session=${sessionId} labType=${labType} container=${container.id.slice(0, 12)}`);
    return sessionId;
}

export const getSession = async (sessionId: string): Promise<LabSession | null> => {
    const raw = await redis.get(`lab:session:${sessionId}`);
    if (!raw) return null;

    return JSON.parse(raw) as LabSession;
}

export const refreshSession = async (sessionId: string): Promise<void> => {
    const raw = await redis.get(`lab:session:${sessionId}`);
    if (!raw) return;

    const session: LabSession = JSON.parse(raw);
    session.lastActivity = Date.now();

    await redis.set(
        `lab:session:${sessionId}`,
        JSON.stringify(session),
        "EX",
        SESSION_TTL
    );
}

export const stopLab = async (sessionId: string): Promise<void> => {
    const session = await getSession(sessionId);
    if (!session) return;

    try {
        const container = docker.getContainer(session.containerId);
        await container.stop({ t: 5 }).catch(() => { }); // 5s graceful shutdown
        await container.remove({ force: true }).catch(() => { });
    } catch (error) {
        console.error("[Lab] Error stopping container:", error);
    }

    await redis.del(`lab:session:${sessionId}`);

    await Session.updateOne(
        { sessionId },
        {
            $set: {
                status: "STOPPED",
                endedAt: new Date()
            }
        }
    );

    console.log(`[Lab] Stopped session=${sessionId}`);
}

// Running Code (non-interactive HTTP)
export const runCode = async (sessionId: string): Promise<string> => {
    const session = await getSession(sessionId);
    if (!session) throw new Error("Session not found or expired");

    await refreshSession(sessionId);

    const container = docker.getContainer(session.containerId);

    // execution initiation inside the container
    const exec = await container.exec({
        Cmd: ["python", "/workspace/main.py"],
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
    });

    const stream = await exec.start({ hijack: true, stdin: false });

    // Docker multiplexes stdout/stderr — demux into separate PassThrough streams
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    docker.modem.demuxStream(stream, stdout, stderr);

    return new Promise((resolve) => {
        const chunks: string[] = [];

        stdout.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
        stderr.on("data", (chunk: Buffer) => chunks.push(`[stderr] ${chunk.toString()}`));

        stream.on("end", () => resolve(chunks.join("")));

        // Safety timeout: killing runaway scripts after 30s
        setTimeout(() => resolve(chunks.join("") + "\n[Terminated: 30s timeout]"), 30_000);
    });
}

// cleanup hook
export const destroyContainer = async (containerId: string): Promise<void> => {
    try {
        const container = docker.getContainer(containerId);
        await container.stop({ t: 3 }).catch(() => { });
        await container.remove({ force: true }).catch(() => { });

        console.log(`[Cleanup] Destroyed container=${containerId.slice(0, 12)}`);
    } catch (err) {
        console.error("[Cleanup] Failed to destroy container:", err);
    }
} 
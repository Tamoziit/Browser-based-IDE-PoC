import * as k8s from "@kubernetes/client-node";
import { k8sCore, k8sExec, NS } from "../config/k8s";
import type { LabSession, LabType } from "../types";
import Session from "../models/session.model";
import { v4 as uuid } from "uuid";
import { redis, SESSION_TTL } from "../config/redis";
import { PassThrough } from "stream";

const RUNTIME_IMAGES: Record<string, string> = {
    python: process.env.LAB_IMAGE_PYTHON ?? "localhost:5000/nc-labs/python:latest",
};

const STORAGE_CLASS = process.env.PVC_STORAGE_CLASS ?? "standard";
const STORAGE_SIZE = process.env.PVC_STORAGE_SIZE ?? "1Gi";

const MC_IMAGE = "minio/mc:latest";

// helpers
const sessionKey = (sessionId: string) => `lab:session:${sessionId}`;
const podName = (sessionId: string) => `lab-${sessionId}`;
const pvcName = (sessionId: string) => `lab-pvc-${sessionId}`;
const svcName = (sessionId: string) => `lab-svc-${sessionId}`;
const workspacePath = (userId: string, labId: string) =>
    `/workspace/${userId}/${labId}`;

const buildPVC = (sessionId: string): k8s.V1PersistentVolumeClaim => {
    return {
        apiVersion: "v1",
        kind: "PersistentVolumeClaim",
        metadata: {
            name: pvcName(sessionId),
            namespace: NS,
            labels: {
                app: "lab",
                sessionId
            }
        },
        spec: {
            accessModes: ["ReadWriteOnce"],
            storageClassName: STORAGE_CLASS,
            resources: {
                requests: {
                    storage: STORAGE_SIZE
                }
            }
        }
    };
}

const buildPod = (
    sessionId: string,
    userId: string,
    labId: string,
    image: string,
    labType: LabType
): k8s.V1Pod => {
    const wPath = workspacePath(userId, labId);

    const minioEndpoint =
        `http://${process.env.MINIO_ENDPOINT_POD ?? "host.docker.internal"}:${process.env.MINIO_PORT ?? "9000"}`;
    const minioAK = process.env.MINIO_ACCESS_KEY;
    const minioSK = process.env.MINIO_SECRET_KEY;
    const templateBucket = process.env.MINIO_BUCKET_TEMPLATES ?? "nc-lms-templates";

    const initCmd = [
        "sh", "-c",
        [
            // create workspace dir
            `mkdir -p ${wPath}`,
            // set up mc alias
            `mc alias set store ${minioEndpoint} ${minioAK} ${minioSK} --quiet`,
            // copy template files (silently ignore if no template exists)
            `mc cp --recursive store/${templateBucket}/${labId}/ ${wPath}/ 2>/dev/null || true`,
            // if nothing was seeded, drop a starter file
            `[ -f ${wPath}/main.py ] || echo '# Your Python lab\nprint("Hello from the lab!")' > ${wPath}/main.py`,
        ].join(" && "),
    ];

    // RO_EXEC: workspace mounted read-only; RWX: read-write
    const workspaceMount: k8s.V1VolumeMount = {
        name: "workspace",
        mountPath: "/workspace",
    };

    return {
        apiVersion: "v1",
        kind: "Pod",
        metadata: {
            name: podName(sessionId),
            namespace: NS,
            labels: {
                app: "lab",
                sessionId,
                userId,
                labId,
                labType
            },
        },
        spec: {
            restartPolicy: "Never",

            initContainers: [
                {
                    name: "seed-workspace",
                    image: MC_IMAGE,
                    command: initCmd,
                    volumeMounts: [
                        {
                            name: "workspace",
                            mountPath: "/workspace"
                        }
                    ]
                },
            ],

            containers: [
                {
                    name: "lab",
                    image,
                    imagePullPolicy: (process.env.LAB_IMAGE_PULL_POLICY ?? "Never") as k8s.V1Container["imagePullPolicy"], // To be set "Always" for prod
                    // Barebone image: just bash + python. No embedded files.
                    command: ["bash", "-c", "sleep infinity"],
                    workingDir: wPath,
                    tty: true,
                    stdin: true,
                    volumeMounts: [workspaceMount],
                    resources: {
                        requests: { cpu: "250m", memory: "256Mi" },
                        limits: { cpu: "1", memory: "512Mi" },
                    },
                    ...(labType === "RO_EXEC" ? {
                        securityContext: { readOnlyRootFilesystem: true }
                    } : {}),
                },
            ],

            // RO_EXEC: tmpfs for /tmp so bash still works
            volumes: [
                {
                    name: "workspace",
                    persistentVolumeClaim: { claimName: pvcName(sessionId) },
                },
                ...(labType === "RO_EXEC"
                    ? [{ name: "tmp-vol", emptyDir: { medium: "Memory" as const } }]
                    : []),
            ],
        }
    }
}

// ClusterIP Service manifest (wired in so we can add a pod-internal file/terminal server later)
function buildService(sessionId: string): k8s.V1Service {
    return {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: svcName(sessionId), namespace: NS },
        spec: {
            selector: { sessionId },
            type: "ClusterIP",
            ports: [
                { name: "terminal", port: 3002, targetPort: 3002 },
                { name: "files", port: 3001, targetPort: 3001 },
            ],
        },
    };
}

const waitForPodRunning = async (
    sessionId: string,
    timeoutMs = 120_000
): Promise<void> => {
    const name = podName(sessionId);
    const start = Date.now();
    const interval = 2_000;

    const FATAL_WAITING_REASONS = new Set([
        "ImagePullBackOff",
        "ErrImagePull",
        "CrashLoopBackOff",
        "CreateContainerConfigError",
    ]);

    while (Date.now() - start < timeoutMs) {
        const pod = await k8sCore.readNamespacedPod({ name, namespace: NS });
        const phase = pod.status?.phase;

        if (phase === "Running") return;
        if (phase === "Failed" || phase === "Unknown") {
            throw new Error(`Pod ${name} entered phase: ${phase}`);
        }

        const allContainers = [
            ...(pod.status?.initContainerStatuses ?? []),
            ...(pod.status?.containerStatuses ?? []),
        ];
        for (const cs of allContainers) {
            const reason = cs.state?.waiting?.reason ?? "";
            if (FATAL_WAITING_REASONS.has(reason)) {
                throw new Error(
                    `Pod ${name} container "${cs.name}" stuck in ${reason}: ` +
                    (cs.state?.waiting?.message ?? "check image name / pull policy")
                );
            }
        }

        await new Promise(r => setTimeout(r, interval));
    }

    throw new Error(`Pod ${name} did not reach Running within ${timeoutMs}ms`);
}

// K8S API
export const startLab = async (
    userId: string,
    labId: string,
    runtime: string = "python",
    labType: LabType = "RWX"
): Promise<string> => {
    const existing = await Session.findOne({ userId, labId, status: "RUNNING" });
    if (existing) {
        console.log(`[Lab] Reusing session=${existing._id} pod=${existing.podName}`);
        return existing._id.toString();
    }

    const image = RUNTIME_IMAGES[runtime];
    if (!image) throw new Error(`Unknown runtime: ${runtime}`);

    const sessionId = uuid();
    const wPath = workspacePath(userId, labId);

    // 1. PVC
    await k8sCore.createNamespacedPersistentVolumeClaim({ namespace: NS, body: buildPVC(sessionId) });
    console.log(`[Lab] PVC created: ${pvcName(sessionId)}`);

    // 2. Pod
    await k8sCore.createNamespacedPod({ namespace: NS, body: buildPod(sessionId, userId, labId, image, labType) });
    console.log(`[Lab] Pod created: ${podName(sessionId)}`);

    // 3. Service
    await k8sCore.createNamespacedService({ namespace: NS, body: buildService(sessionId) });

    // 4. Wait for Running
    await waitForPodRunning(sessionId);
    console.log(`[Lab] Pod running: ${podName(sessionId)}`);

    const session: LabSession = {
        sessionId,
        userId,
        labId,
        podName: podName(sessionId),
        pvcName: pvcName(sessionId),
        workspacePath: wPath,
        runtime,
        labType,
        lastActivity: Date.now()
    };
    await redis.set(sessionKey(sessionId), JSON.stringify(session), "EX", SESSION_TTL);

    await Session.create({
        sessionId,
        userId,
        labId,
        runtime,
        labType,
        podName: podName(sessionId),
        pvcName: pvcName(sessionId),
        workspacePath: wPath,
        status: "RUNNING",
    });

    console.log(`[Lab] Started session=${sessionId} labType=${labType}`);
    return sessionId;
}

export const getSession = async (sessionId: string): Promise<LabSession | null> => {
    const raw = await redis.get(sessionKey(sessionId));
    if (!raw) return null;

    return JSON.parse(raw) as LabSession;
};

export const refreshSession = async (sessionId: string): Promise<void> => {
    const key = sessionKey(sessionId);

    const [raw, ttl] = await Promise.all([
        redis.get(key),
        redis.ttl(key),
    ]);

    if (!raw || ttl < 0) return; // key gone or no expiry

    const session: LabSession = JSON.parse(raw);
    session.lastActivity = Date.now();

    await redis.set(key, JSON.stringify(session), "EX", ttl); // preserved remaining TTL
};

export const stopLab = async (sessionId: string): Promise<void> => {
    const session = await getSession(sessionId);
    if (!session) return;

    for (const [kind, name, fn] of [
        ["Pod", podName(sessionId), () => k8sCore.deleteNamespacedPod({ name: podName(sessionId), namespace: NS })],
        ["Service", svcName(sessionId), () => k8sCore.deleteNamespacedService({ name: svcName(sessionId), namespace: NS })],
        ["PVC", pvcName(sessionId), () => k8sCore.deleteNamespacedPersistentVolumeClaim({ name: pvcName(sessionId), namespace: NS })],
    ] as [string, string, () => Promise<unknown>][]) {
        try {
            await fn();
            console.log(`[Lab] Deleted ${kind}: ${name}`);
        } catch (err: any) {
            if (err?.statusCode !== 404 && err?.body?.code !== 404) {
                console.warn(`[Lab] Could not delete ${kind} ${name}:`, err?.body?.message ?? err);
            }
        }
    }

    await redis.del(sessionKey(sessionId));
    await Session.updateOne(
        { sessionId },
        { $set: { status: "STOPPED", endedAt: new Date() } }
    );

    console.log(`[Lab] Stopped session=${sessionId}`);
};

export const runCode = async (sessionId: string): Promise<string> => {
    const session = await getSession(sessionId);
    if (!session) throw new Error("Session not found or expired");

    await refreshSession(sessionId);

    const chunks: string[] = [];
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    stdout.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    stderr.on("data", (chunk: Buffer) => chunks.push(`[stderr] ${chunk.toString()}`));

    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            chunks.push("\n[Terminated: 30s timeout]");
            resolve();
        }, 30_000);

        k8sExec.exec(
            NS,
            session.podName,
            "lab",
            ["python", "-u", `${session.workspacePath}/main.py`],
            stdout,
            stderr,
            null,
            false,
            ({ status }) => {
                clearTimeout(timeout);
                if (status === "Success" || status === "Failure") resolve();
            }
        ).catch(reject);
    });

    return chunks.join("");
}

export const destroyPod = async (podNameStr: string, pvcNameStr: string): Promise<void> => {
    const svcNameStr = podNameStr.replace("lab-", "lab-svc-");

    for (const [kind, fn] of [
        ["Pod", () => k8sCore.deleteNamespacedPod({ name: podNameStr, namespace: NS })],
        ["PVC", () => k8sCore.deleteNamespacedPersistentVolumeClaim({ name: pvcNameStr, namespace: NS })],
        ["Service", () => k8sCore.deleteNamespacedService({ name: svcNameStr, namespace: NS })],
    ] as [string, () => Promise<unknown>][]) {
        try { await fn(); } catch { /* already gone */ }
        console.log(`[Cleanup] Deleted ${kind}: ${podNameStr}`);
    }
};
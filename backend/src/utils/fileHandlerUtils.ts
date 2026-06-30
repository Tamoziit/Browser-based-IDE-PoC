import path from "path";
import { PassThrough, Writable } from "stream";
import { k8sExec, NS } from "../config/k8s";
import { Response } from "express";
import { getSession } from "../services/k8s.service";

// Path guard — prevents traversal outside workspace
export function safePodPath(workspacePath: string, filePath: string): string {
    // workspacePath is an absolute posix path like /workspace/userId/labId
    const resolved = path.posix.normalize(
        path.posix.join(workspacePath, filePath)
    );
    if (
        resolved !== workspacePath &&
        !resolved.startsWith(workspacePath + "/")
    ) {
        throw new Error("Path traversal rejected");
    }

    return resolved;
}

// K8s exec helpers 
export async function execInPod(
    podName: string,
    cmd: string[]
): Promise<string> {
    const out = new PassThrough();
    const chunks: Buffer[] = [];
    out.on("data", (c: Buffer) => chunks.push(c));

    await new Promise<void>((resolve, reject) => {
        k8sExec.exec(
            NS,
            podName,
            "lab",
            cmd,
            out,
            process.stderr as unknown as Writable,
            null,
            false,
            ({ status }) => {
                if (status === "Success") resolve();
                else reject(new Error(`exec [${cmd.join(" ")}] failed: ${status}`));
            }
        ).catch(reject);
    });

    return Buffer.concat(chunks).toString("utf8");
}

export async function writeFileToPod(
    podName: string,
    absPath: string,
    content: string
): Promise<void> {
    console.log(`[writeFileToPod] Starting write to ${absPath} on pod ${podName} (${content.length} bytes)`);

    const b64 = Buffer.from(content).toString("base64");
    await execInPod(podName, [
        "sh",
        "-c",
        `mkdir -p "$(dirname '${absPath}')" && echo "${b64}" | base64 -d > '${absPath}'`
    ]);

    console.log(`[writeFileToPod] Write completed successfully`);
}

// Session resolver
export async function resolveSession(sessionId: string | undefined, res: Response) {
    if (!sessionId) {
        res.status(400).json({ error: "Missing session query param" });
        return null;
    }
    const session = await getSession(sessionId);
    if (!session) {
        res.status(400).json({ error: "Session not found or expired" });
        return null;
    }

    return session;
}

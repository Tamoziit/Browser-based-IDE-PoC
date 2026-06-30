
import dotenv from "dotenv";
import { PassThrough, Writable } from "stream";
import { k8sExec, NS } from "../config/k8s";
import fs from "fs/promises";

export async function readFileFromPod(
    podName: string,
    filePath: string // absolute path inside container
): Promise<string> {
    const out = new PassThrough();
    const chunks: Buffer[] = [];

    out.on("data", (c: Buffer) => chunks.push(c));

    await new Promise<void>((resolve, reject) => {
        k8sExec.exec(
            NS,
            podName,
            "lab",
            ["cat", filePath],
            out,
            process.stderr as unknown as Writable,
            null,
            false,
            ({ status }) => {
                if (status === "Success") resolve();
                else reject(new Error(`cat ${filePath} failed in pod ${podName}: ${status}`));
            }
        ).catch(reject);
    });

    return Buffer.concat(chunks).toString("utf8");
}

export async function fileExistsOnHost(filePath: string): Promise<boolean> {
    try { await fs.access(filePath); return true; } catch { return false; }
}

export async function evaluateEnvFile(
    evalFilePath: string,
    podName: string,
    podFilePath: string
): Promise<{ passed: boolean; details?: string }> {
    let userContent: string;
    try {
        userContent = await readFileFromPod(podName, podFilePath);
    } catch {
        return { passed: false, details: "File not found in workspace." };
    }

    const evalContent = await fs.readFile(evalFilePath, "utf8");
    const evalEnv = dotenv.parse(evalContent);
    const userEnv = dotenv.parse(userContent);

    const missingKeys = Object.keys(evalEnv).filter(k => !(k in userEnv));
    const emptyKeys = Object.keys(evalEnv).filter(k => k in userEnv && !userEnv[k]?.trim());

    if (missingKeys.length || emptyKeys.length) {
        let details = "";
        if (missingKeys.length) details += `Missing keys: ${missingKeys.join(", ")}. `;
        if (emptyKeys.length) details += `Empty values: ${emptyKeys.join(", ")}.`;
        return { passed: false, details: details.trim() };
    }
    return { passed: true };
}

export async function evaluateExactMatch(
    evalFilePath: string,
    podName: string,
    podFilePath: string
): Promise<{ passed: boolean; details?: string }> {
    let userContent: string;
    try {
        userContent = await readFileFromPod(podName, podFilePath);
    } catch {
        return { passed: false, details: "File not found in workspace." };
    }

    const evalContent = (await fs.readFile(evalFilePath, "utf8")).trim();
    if (evalContent === userContent.trim()) return { passed: true };
    return { passed: false, details: "File contents do not match the expected output." };
}

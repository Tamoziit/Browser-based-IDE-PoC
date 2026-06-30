import { PassThrough, Writable } from "stream";
import type { LabSession } from "../types";
import { k8sExec, NS } from "../config/k8s";
import { BUCKET_SNAPSHOTS, minio } from "../config/minio";
import Session from "../models/session.model";

const snapshotWorkspace = async (session: LabSession): Promise<void> => {
    const { sessionId, podName, workspacePath } = session;

    // Stream `tar czf - -C <workspacePath> .` out of the pod
    const tarStream = new PassThrough();

    const execDone = new Promise<void>((resolve, reject) => {
        k8sExec.exec(
            NS,
            podName,
            "lab",
            ["tar", "czf", "-", "-C", workspacePath, "."],
            tarStream, // stdout → tar bytes
            process.stderr as unknown as Writable,
            null,
            false,
            ({ status }) => {
                if (status === "Success") {
                    resolve();
                } else {
                    const err = new Error(`tar exec failed: ${status}`);
                    tarStream.destroy(err); // signals minio to abort
                    reject(err);
                }
            }
        ).catch(reject);
    });

    tarStream.on("error", (err) => {
        // Rejection is surfaced through execDone
        console.error(`[Snapshot] tarStream error for ${sessionId}:`, err.message);
    });

    const objectKey = `${sessionId}/workspace.tar.gz`;

    await Promise.all([
        minio.putObject(BUCKET_SNAPSHOTS, objectKey, tarStream),
        execDone,  // ensures exec completed
    ]);

    await Session.updateOne(
        { sessionId },
        {
            $set: {
                workspaceSnapshot: `${BUCKET_SNAPSHOTS}/${objectKey}`
            }
        }
    );

    console.log(`[Snapshot] OK: ${sessionId} → ${BUCKET_SNAPSHOTS}/${objectKey}`);
}

export default snapshotWorkspace;
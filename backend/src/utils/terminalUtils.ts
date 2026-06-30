import { posix as posixPath } from "path";
import { TerminalState } from "../types";
import { k8sExec, NS } from "../config/k8s";

export const WORKSPACE_ROOT = "/workspace";
export const CONTAINER_HOME = "/root";
export const RED = "\x1b[31m";
export const YELLOW = "\x1b[33m";
export const RESET = "\x1b[0m";
export const BELL = "\x07";

export function parseCdArg(line: string): string | null {
    const m = line.match(/^\s*cd(?:\s+(.*))?$/);
    if (!m) return null;

    return (m[1] ?? "").trim();
}

export function resolveNewCwd(current: string, arg: string): string {
    if (!arg || arg === "~") return CONTAINER_HOME;
    if (arg.startsWith("~/")) return posixPath.normalize(CONTAINER_HOME + "/" + arg.slice(2));
    if (arg.startsWith("/")) return posixPath.normalize(arg);

    return posixPath.normalize(posixPath.join(current, arg));
}

export function isInsideWorkspace(p: string): boolean {
    const n = posixPath.normalize(p);
    return n === WORKSPACE_ROOT || n.startsWith(WORKSPACE_ROOT + "/");
}

export async function killRunningExec(state: TerminalState): Promise<void> {
    try {
        await k8sExec.exec(
            NS,
            state.session.podName,
            "lab",
            ["pkill", "-f", `python ${state.session.workspacePath}/main.py`],
            null,
            null,
            null,
            false,
            () => { }
        );
    } catch { /* ignore */ }
}
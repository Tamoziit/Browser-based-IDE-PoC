import type { Socket } from "socket.io";
import type { TerminalState } from "../types";
import { k8sExec, NS } from "../config/k8s";
import { PassThrough, Writable } from "stream";
import { BELL, isInsideWorkspace, killRunningExec, parseCdArg, RED, RESET, resolveNewCwd, YELLOW } from "../utils/terminalUtils";
import { refreshSession } from "../services/k8s.service";

export const initTerminalExec = async (
    socket: Socket,
    state: TerminalState
): Promise<void> => {
    try {
        const { session, stdoutStream, stdinStream } = state;

        stdoutStream.on("data", (chunk: Buffer) => {
            socket.emit("output", { data: chunk.toString() });
        });

        if (session.labType === "RO_EXEC") return;

        state.execWebSocket = await k8sExec.exec(
            NS,
            session.podName,
            "lab",
            ["bash"],
            stdoutStream,
            process.stderr as Writable,
            stdinStream,
            true,
            ({ status }) => {
                console.log(`[WS] exec exited session=${session.sessionId} status=${status}`);
                socket.emit("output", { data: `\r\n${RED}[Terminal closed]${RESET}\r\n` });
            }
        );
    } catch (error) {
        console.log("Error in initTerminalExec controller", error);
    }
}

export const handleInput = async (
    data: string,
    socket: Socket,
    state: TerminalState,
    sessionId: string
): Promise<void> => {
    try {
        if (!state.execWebSocket) return;

        for (const ch of data) {
            const code = ch.charCodeAt(0);

            if (code === 0x03 || code === 0x04 || code === 0x1a) {
                state.lineBuffer = "";
                state.stdinStream.push(ch);
                return;
            }
            if (code === 0x7f || code === 0x08) {
                if (state.lineBuffer.length > 0) state.lineBuffer = state.lineBuffer.slice(0, -1);
                state.stdinStream.push(ch);
                continue;
            }
            if (code === 0x1b) {
                state.stdinStream.push(data);
                return;
            }

            if (ch === "\r" || ch === "\n") {
                const line = state.lineBuffer.trim();
                state.lineBuffer = "";
                const cdArg = parseCdArg(line);

                if (cdArg !== null) {
                    const newCwd = cdArg === "-"
                        ? state.previousCwd
                        : resolveNewCwd(state.trackedCwd, cdArg);

                    if (!isInsideWorkspace(newCwd)) {
                        state.stdinStream.push("\x15");
                        socket.emit("output", {
                            data: `\r\n${RED}[SANDBOX] Blocked: "${newCwd}" is outside /workspace.${RESET}\r\n` +
                                `${YELLOW}You are confined to /workspace and its subdirectories.${RESET}\r\n` +
                                BELL,
                        });

                        continue;
                    }

                    state.previousCwd = state.trackedCwd;
                    state.trackedCwd = newCwd;
                    state.stdinStream.push(ch);
                    continue;
                }

                if (!isInsideWorkspace(state.trackedCwd)) {
                    state.stdinStream.push("\x15");
                    socket.emit("output", {
                        data: `\r\n${RED}[SANDBOX] cwd "${state.trackedCwd}" is outside /workspace.${RESET}\r\n` +
                            `${YELLOW}Returning to /workspace...${RESET}\r\n` + BELL,
                    });

                    state.stdinStream.push(`cd ${state.session.workspacePath}\r`);
                    state.previousCwd = state.trackedCwd;
                    state.trackedCwd = state.session.workspacePath;
                    continue;
                }

                state.stdinStream.push(ch);
                continue;
            }

            state.lineBuffer += ch;
            state.stdinStream.push(ch);
        }

        await refreshSession(sessionId);
    } catch (error) {
        console.log("Error in handleInput controller", error);
    }
}

export const handleResize = (
    cols: number,
    rows: number,
    state: TerminalState
): void => {
    try {
        if (!state.execWebSocket || state.execWebSocket.readyState !== 1)
            return;

        const resizeMsg = JSON.stringify({
            Width: cols,
            Height: rows
        });

        const buf = Buffer.alloc(1 + resizeMsg.length);
        buf[0] = 4;
        buf.write(resizeMsg, 1);

        state.execWebSocket.send(buf);
    } catch (error) {
        console.log("Error in handleResize controller", error);
    }
}

export const handleRun = async (
    socket: Socket,
    state: TerminalState,
    sessionId: string
): Promise<void> => {
    try {
        if (state.runExecWs) {
            socket.emit("run_error", { message: "Already running" });
            return;
        }

        const outStream = new PassThrough();
        const errStream = new PassThrough();

        outStream.on("data", (c: Buffer) => socket.emit("output", { data: c.toString() }));
        errStream.on("data", (c: Buffer) => socket.emit("output", { data: `[stderr] ${c.toString()}` }));

        state.runExecWs = await k8sExec.exec(
            NS,
            state.session.podName,
            "lab",
            ["python", "-u", `${state.session.workspacePath}/main.py`],
            outStream,
            errStream,
            null,
            false,
            ({ status }) => {
                state.runExecWs = null;
                if (state.runTimeout) clearTimeout(state.runTimeout);
                socket.emit("exit", { code: status === "Success" ? 0 : 1 });
            }
        );

        state.runTimeout = setTimeout(async () => {
            if (state.runExecWs) {
                socket.emit("output", { data: "\n[Terminated: 30s timeout]\n" });
                socket.emit("exit", { code: -1 });
                state.runExecWs = null;

                await killRunningExec(state);
            }
        }, 30_000);

        await refreshSession(sessionId);
    } catch (error) {
        console.log("Error in handleRun controller", error);
    }
}

export const handleKill = async (
    socket: Socket,
    state: TerminalState
): Promise<void> => {
    try {
        if (!state.runExecWs) return;

        try {
            state.runExecWs.close();
        } catch { /* ignore */ }

        state.runExecWs = null;
        if (state.runTimeout)
            clearTimeout(state.runTimeout);

        socket.emit("output", { data: "\n[Terminated by user]\n" });
        socket.emit("exit", { code: -1 });
        await killRunningExec(state);
    } catch (error) {
        console.log("Error in handleKill controller", error);
    }
}

export const handleDisconnect = (sessionId: string, state: TerminalState): void => {
    console.log(`[WS] Disconnected session=${sessionId}`);

    try {
        state.stdinStream.destroy();
    } catch { /* ignore */ }

    try {
        if (state.runExecWs) state.runExecWs.close();
    } catch { /* ignore */ }

    if (state.runTimeout)
        clearTimeout(state.runTimeout);
}
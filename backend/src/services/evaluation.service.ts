import fs from "fs/promises";
import path from "path";
import { getSession } from "./k8s.service";
import type { EvaluationResult } from "../types/index";
import { evaluateEnvFile, evaluateExactMatch, fileExistsOnHost } from "../utils/evaluators";

export const evaluateLab = async (sessionId: string): Promise<EvaluationResult> => {
    const session = await getSession(sessionId);
    if (!session) throw new Error("Session not found or expired");

    const { labId, workspacePath, podName } = session;
    const evaluationDir = path.resolve(process.env.EVALUATION_DIR ?? "./evaluation", labId);
    const rubricsPath = path.join(evaluationDir, "rubrics.txt");

    if (!(await fileExistsOnHost(rubricsPath))) {
        throw new Error("Rubrics file not found for this lab.");
    }

    const lines = (await fs.readFile(rubricsPath, "utf8"))
        .split("\n").map(l => l.trim()).filter(l => l.startsWith("check "));

    const results: EvaluationResult["results"] = [];
    let passedCount = 0;

    for (const line of lines) {
        const fileName = line.slice("check ".length).trim();
        const evalPath = path.join(evaluationDir, fileName);
        const podFilePath = `${workspacePath}/${fileName}`;

        if (!(await fileExistsOnHost(evalPath))) {
            results.push({ step: `check ${fileName}`, passed: false, details: "Template missing in evaluation directory." });
            continue;
        }

        const result = fileName === ".env"
            ? await evaluateEnvFile(evalPath, podName, podFilePath)
            : await evaluateExactMatch(evalPath, podName, podFilePath);

        if (result.passed) passedCount++;
        results.push({ step: `check ${fileName}`, passed: result.passed, details: result.details ?? "" });
    }

    const maxScore = results.length;
    const percentage = maxScore === 0 ? 100 : Math.round((passedCount / maxScore) * 100);

    return { score: passedCount, maxScore, percentage, results };
};

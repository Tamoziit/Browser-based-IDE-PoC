import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";
import { getSession } from "./docker.service.js";
import type { EvaluationResult } from "../types/index.js";

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Checks if the user's .env contains all keys specified in the template,
 * and ensures they have a non-empty value.
 */
async function evaluateEnvFile(evalFilePath: string, userFilePath: string): Promise<{ passed: boolean; details?: string }> {
    if (!(await fileExists(userFilePath))) {
        return { passed: false, details: "File not found in workspace." };
    }

    try {
        const evalContent = await fs.readFile(evalFilePath, "utf8");
        const userContent = await fs.readFile(userFilePath, "utf8");

        const evalEnv = dotenv.parse(evalContent);
        const userEnv = dotenv.parse(userContent);

        const missingKeys: string[] = [];
        const emptyKeys: string[] = [];

        for (const key of Object.keys(evalEnv)) {
            if (!(key in userEnv)) {
                missingKeys.push(key);
            } else if (!userEnv[key] || userEnv[key].trim() === "") {
                emptyKeys.push(key);
            }
        }

        if (missingKeys.length > 0 || emptyKeys.length > 0) {
            let details = "";
            if (missingKeys.length > 0) details += `Missing keys: ${missingKeys.join(", ")}. `;
            if (emptyKeys.length > 0) details += `Empty values for keys: ${emptyKeys.join(", ")}.`;
            return { passed: false, details: details.trim() };
        }

        return { passed: true };
    } catch (err: any) {
        return { passed: false, details: `Error reading files: ${err.message}` };
    }
}

/**
 * Checks if the user's file matches the evaluation file exactly (ignoring leading/trailing whitespace).
 */
async function evaluateExactMatch(evalFilePath: string, userFilePath: string): Promise<{ passed: boolean; details?: string }> {
    if (!(await fileExists(userFilePath))) {
        return { passed: false, details: "File not found in workspace." };
    }

    try {
        const evalContent = (await fs.readFile(evalFilePath, "utf8")).trim();
        const userContent = (await fs.readFile(userFilePath, "utf8")).trim();

        if (evalContent === userContent) {
            return { passed: true };
        }

        return { passed: false, details: "File contents do not match the expected output." };
    } catch (err: any) {
        return { passed: false, details: `Error reading files: ${err.message}` };
    }
}

export const evaluateLab = async (sessionId: string): Promise<EvaluationResult> => {
    const session = await getSession(sessionId);
    if (!session) {
        throw new Error("Session not found or expired");
    }

    const { labId, workspacePath } = session;
    const evaluationDir = path.resolve(process.env.EVALUATION_DIR ?? "./evaluation", labId);
    const rubricsPath = path.join(evaluationDir, "rubrics.txt");

    if (!(await fileExists(rubricsPath))) {
        throw new Error("Rubrics file not found for this lab.");
    }

    const rubricsContent = await fs.readFile(rubricsPath, "utf8");
    const lines = rubricsContent.split("\n").map(l => l.trim()).filter(l => l.length > 0);

    const results: EvaluationResult["results"] = [];
    let passedCount = 0;

    for (const line of lines) {
        if (!line.startsWith("check ")) continue;

        const fileName = line.slice("check ".length).trim();
        const evalFilePath = path.join(evaluationDir, fileName);
        const userFilePath = path.join(workspacePath, fileName);

        // Fail automatically if template file doesn't exist in evaluation dir
        if (!(await fileExists(evalFilePath))) {
            results.push({ step: `check ${fileName}`, passed: false, details: "Template file missing in evaluation directory." });
            continue;
        }

        let result: { passed: boolean; details?: string };

        if (fileName === ".env") {
            result = await evaluateEnvFile(evalFilePath, userFilePath);
        } else {
            result = await evaluateExactMatch(evalFilePath, userFilePath);
        }

        if (result.passed) passedCount++;

        results.push({
            step: `check ${fileName}`,
            passed: result.passed,
            details: result.details ?? ""
        });
    }

    const maxScore = results.length;
    const percentage = maxScore === 0 ? 100 : Math.round((passedCount / maxScore) * 100);

    return {
        score: passedCount,
        maxScore,
        percentage,
        results
    };
};

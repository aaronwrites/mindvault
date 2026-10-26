import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { PdfEvidence } from "../../db/schema";

export type PdfProcessingLimits = {
    maximumBytes: number;
    maximumPages: number;
    maximumCharacters: number;
    timeoutMs: number;
    heapMiB: number;
};
export function pdfProcessingLimits(environment: NodeJS.ProcessEnv = process.env): PdfProcessingLimits {
    return {
        maximumBytes: positiveInteger(environment.PDF_MAXIMUM_BYTES, 50 * 1024 * 1024),
        maximumPages: positiveInteger(environment.PDF_MAXIMUM_PAGES, 200),
        maximumCharacters: positiveInteger(environment.PDF_MAXIMUM_CHARACTERS, 1_000_000),
        timeoutMs: positiveInteger(environment.PDF_TIMEOUT_MS, 30_000),
        heapMiB: positiveInteger(environment.PDF_HEAP_MIB, 256),
    };
}
function positiveInteger(value: string | undefined, fallback: number): number {
    if (value === undefined) return fallback;
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1) throw new Error("PDF processing limits must be positive integers");
    return number;
}
export async function extractPdf(bytes: Uint8Array, limits: PdfProcessingLimits): Promise<PdfEvidence> {
    return new Promise((resolve, reject) => {
        const child = execFile(process.env.PDF_NODE_EXECUTABLE ?? "node", [
            `--max-old-space-size=${limits.heapMiB}`,
            fileURLToPath(new URL("extract-pdf-process.mjs", import.meta.url)), JSON.stringify(limits),
        ], { timeout: limits.timeoutMs, maxBuffer: limits.maximumCharacters * 6 + limits.maximumPages * 1024, env: { PATH: process.env.PATH } }, (error, stdout, stderr) => {
            if (error) {
                const reason = error.killed ? "PDF processing time or memory limit exceeded; no pages were indexed"
                    : stderr.match(/MINDVAULT_PDF_ERROR: (.*)/u)?.[1]?.slice(0, 1000)
                        ?? (error.code === "ENOENT" ? "PDF parser runtime is unavailable; install Node.js or configure PDF_NODE_EXECUTABLE"
                            : "PDF processing memory/output limit exceeded or parser exited unexpectedly; no pages were indexed");
                reject(new Error(reason));
            } else {
                try { resolve(JSON.parse(stdout) as PdfEvidence); } catch { reject(new Error("PDF parser returned unreadable evidence")); }
            }
        });
        child.stdin?.on("error", () => {}); // Early parser exit may close stdin.
        child.stdin?.end(bytes);
    });
}

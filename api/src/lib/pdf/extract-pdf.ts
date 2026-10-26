import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { PdfEvidence } from "../../db/schema";

export type PdfProcessingLimits = {
    maximumBytes: number;
    maximumPages: number;
    maximumCharacters: number;
    timeoutMs: number;
    heapMiB: number;
    maximumOcrPages: number;
    renderDpi: number;
    maximumRenderPixels: number;
    maximumTotalRenderPixels: number;
    ocrTimeoutMs: number;
    ocrExecutable: string;
};
export function pdfProcessingLimits(environment: NodeJS.ProcessEnv = process.env): PdfProcessingLimits {
    return {
        maximumBytes: positiveInteger(environment.PDF_MAXIMUM_BYTES, 50 * 1024 * 1024),
        maximumPages: positiveInteger(environment.PDF_MAXIMUM_PAGES, 200),
        maximumCharacters: positiveInteger(environment.PDF_MAXIMUM_CHARACTERS, 1_000_000),
        timeoutMs: positiveInteger(environment.PDF_TIMEOUT_MS, 30_000),
        heapMiB: positiveInteger(environment.PDF_HEAP_MIB, 256),
        maximumOcrPages: positiveInteger(environment.PDF_MAXIMUM_OCR_PAGES, 20),
        renderDpi: positiveInteger(environment.PDF_RENDER_DPI, 150),
        maximumRenderPixels: positiveInteger(environment.PDF_MAXIMUM_RENDER_PIXELS, 8_000_000),
        maximumTotalRenderPixels: positiveInteger(environment.PDF_MAXIMUM_TOTAL_RENDER_PIXELS, 80_000_000),
        ocrTimeoutMs: positiveInteger(environment.PDF_OCR_TIMEOUT_MS, 5_000),
        ocrExecutable: environment.PDF_TESSERACT_EXECUTABLE ?? "tesseract",
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
        const child = spawn(process.env.PDF_NODE_EXECUTABLE ?? "node", [
            `--max-old-space-size=${limits.heapMiB}`,
            fileURLToPath(new URL("extract-pdf-process.mjs", import.meta.url)), JSON.stringify(limits),
        ], { detached: process.platform !== "win32", env: { PATH: process.env.PATH }, stdio: ["pipe", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        let size = 0;
        let timedOut = false;
        let outputExceeded = false;
        const terminate = () => {
            if (process.platform !== "win32" && child.pid) {
                try { process.kill(-child.pid, "SIGKILL"); } catch { /* Already exited. */ }
            } else child.kill("SIGKILL");
        };
        const timer = setTimeout(() => { timedOut = true; terminate(); }, limits.timeoutMs);
        const maximumOutput = limits.maximumCharacters * 6 + limits.maximumPages * 1024;
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
            size += Buffer.byteLength(chunk);
            if (size > maximumOutput) { outputExceeded = true; terminate(); }
            else stdout += chunk;
        });
        child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-16_000); });
        child.on("error", () => {
            clearTimeout(timer);
            reject(new Error("PDF parser runtime is unavailable; install Node.js or configure PDF_NODE_EXECUTABLE"));
        });
        child.on("close", code => {
            clearTimeout(timer);
            if (code !== 0 || timedOut || outputExceeded) {
                terminate();
                const reason = timedOut ? "PDF processing time or memory limit exceeded; no pages were indexed"
                    : stderr.match(/MINDVAULT_PDF_ERROR: (.*)/u)?.[1]?.slice(0, 1000)
                        ?? "PDF processing memory/output limit exceeded or parser exited unexpectedly; no pages were indexed";
                reject(new Error(reason));
            } else {
                try { resolve(JSON.parse(stdout) as PdfEvidence); } catch { reject(new Error("PDF parser returned unreadable evidence")); }
            }
        });
        child.stdin.on("error", () => {}); // Early parser exit may close stdin.
        child.stdin.end(bytes);
    });
}

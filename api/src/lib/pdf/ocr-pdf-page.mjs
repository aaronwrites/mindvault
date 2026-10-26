import { execFileSync } from "node:child_process";

// One page at a time; no temporary files or application environment reach OCR.
export async function ocrPdfPage(document, page, limits, budget) {
    const viewport = page.getViewport({ scale: limits.renderDpi / 72 });
    const pixels = Math.ceil(viewport.width) * Math.ceil(viewport.height);
    if (!Number.isSafeInteger(pixels) || pixels < 1 || pixels > limits.maximumRenderPixels) {
        return { outcome: "unprocessed", reason: "Page rendering pixel limit exceeded" };
    }
    if (budget.pages >= limits.maximumOcrPages || budget.pixels + pixels > limits.maximumTotalRenderPixels) {
        return { outcome: "unprocessed", reason: "Document rendering/OCR work limit reached" };
    }
    // Reserve enough remaining wall time to finish a bounded OCR invocation.
    if (Date.now() + limits.ocrTimeoutMs + 250 >= budget.deadline) {
        return { outcome: "unprocessed", reason: "Document OCR time budget reached" };
    }
    budget.pages++;
    budget.pixels += pixels;
    const factory = document.canvasFactory;
    const surface = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
    try {
        await page.render({ canvasContext: surface.context, viewport, background: "white" }).promise;
        const { data } = surface.context.getImageData(0, 0, surface.canvas.width, surface.canvas.height);
        let marks = 0;
        for (let offset = 0; offset < data.length; offset += 4) {
            if (Math.min(data[offset], data[offset + 1], data[offset + 2]) < 245) marks++;
        }
        // Only an effectively white raster is blank. Empty OCR on a marked page is unreadable.
        if (marks === 0) return { outcome: "blank", reason: null };
        let tsv;
        try {
            tsv = execFileSync(limits.ocrExecutable, ["stdin", "stdout", "-l", "eng", "--psm", "3", "--dpi", String(limits.renderDpi), "tsv"], {
                input: surface.canvas.toBuffer("image/png"), encoding: "utf8", timeout: limits.ocrTimeoutMs,
                killSignal: "SIGKILL", maxBuffer: Math.min(32_000_000, limits.maximumCharacters * 20 + 100_000),
                env: { PATH: process.env.PATH, OMP_THREAD_LIMIT: "1" },
            });
        } catch (error) {
            if (error.code === "ENOENT") throw new Error("Local OCR runtime unavailable; install Tesseract with English data or configure PDF_TESSERACT_EXECUTABLE");
            if (error.stderr?.includes("Failed loading language")) throw new Error("Local OCR English data unavailable; install Tesseract eng.traineddata");
            return { outcome: "failed", method: "ocr", reason: "Local OCR failed or exceeded its time/output limit; retry processing" };
        }
        const words = tsv.split("\n").slice(1).map(line => line.split("\t"))
            .filter(fields => fields[0] === "5" && fields[11]?.trim())
            .map(fields => ({ line: fields.slice(1, 5).join(":"), confidence: Number(fields[10]), text: fields[11].trim() }));
        const length = words.reduce((total, word) => total + word.text.length, 0);
        const confidence = words.reduce((total, word) => total + Math.max(0, word.confidence) * word.text.length, 0) / Math.max(1, length);
        const trustedLength = words.filter(word => word.confidence >= 50).reduce((total, word) => total + word.text.length, 0);
        let text = "";
        let previousLine;
        for (const word of words) {
            text += (text ? word.line === previousLine ? " " : "\n" : "") + word.text;
            previousLine = word.line;
        }
        const readable = (text.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 30 && words.length >= 5 && !text.includes("\uFFFD");
        if (!readable || confidence < 70 || trustedLength < length * 0.8) {
            return { outcome: "unreadable", method: "ocr", reason: "No trustworthy printed English text from local OCR; visual content has not been interpreted" };
        }
        return { outcome: "extracted", method: "ocr", text, reason: null };
    } finally {
        factory.destroy(surface);
    }
}

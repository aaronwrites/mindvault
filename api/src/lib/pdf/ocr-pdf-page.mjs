import { execFileSync } from "node:child_process";

// One page at a time; no temporary files or application environment reach OCR.
export async function ocrPdfPage(document, page, limits, budget, nativeLines = []) {
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
        // Retry only the incomplete OCR work, reusing this page's rendered bytes.
        const image = surface.canvas.toBuffer("image/png");
        for (let attempt = 0; attempt < 2; attempt++) {
            if (Date.now() + limits.ocrTimeoutMs + 250 >= budget.deadline) break;
            try {
                tsv = execFileSync(limits.ocrExecutable, ["stdin", "stdout", "-l", "eng", "--psm", "3", "--dpi", String(limits.renderDpi), "tsv"], {
                    input: image, encoding: "utf8", timeout: limits.ocrTimeoutMs,
                    killSignal: "SIGKILL", maxBuffer: Math.min(32_000_000, limits.maximumCharacters * 20 + 100_000),
                    env: { PATH: process.env.PATH, OMP_THREAD_LIMIT: "1" },
                });
                break;
            } catch (error) {
                if (error.code === "ENOENT") throw new Error("Local OCR runtime unavailable; install Tesseract with English data or configure PDF_TESSERACT_EXECUTABLE");
                if (error.stderr?.includes("Failed loading language")) throw new Error("Local OCR English data unavailable; install Tesseract eng.traineddata");
            }
        }
        if (tsv === undefined) return { outcome: "failed", method: "ocr", reason: "Local OCR failed or exceeded its time/output limit after bounded automatic retry; retry processing" };
        const nativeLayout = nativeLines.map(line => {
            const regions = line.items.map(item => {
                const height = Math.max(item.height, Math.abs(item.transform[3]));
                const [x1, y1] = viewport.convertToViewportPoint(item.transform[4], item.transform[5] - height * 0.3);
                const [x2, y2] = viewport.convertToViewportPoint(item.transform[4] + item.width, item.transform[5] + height);
                return { left: Math.min(x1, x2), top: Math.min(y1, y2), right: Math.max(x1, x2), bottom: Math.max(y1, y2) };
            });
            return { text: line.text, top: Math.min(...regions.map(region => region.top)), left: Math.min(...regions.map(region => region.left)), regions };
        });
        const nativeRegions = nativeLayout.flatMap(line => line.regions);
        const words = tsv.split("\n").slice(1).map(line => line.split("\t"))
            .filter(fields => fields[0] === "5" && fields[11]?.trim())
            .map(fields => ({ line: fields.slice(1, 5).join(":"), confidence: Number(fields[10]), text: fields[11].trim(),
                left: Number(fields[6]), top: Number(fields[7]), width: Number(fields[8]), height: Number(fields[9]) }))
            // Exact native text owns its physical region. Do not let OCR spelling
            // or punctuation replace it, or index another copy of those words.
            .filter(word => !nativeRegions.some(region => word.left + word.width / 2 >= region.left - 2
                && word.left + word.width / 2 <= region.right + 2 && word.top + word.height / 2 >= region.top - 2
                && word.top + word.height / 2 <= region.bottom + 2));
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
        const ocrLines = new Map();
        for (const word of words) {
            const line = ocrLines.get(word.line);
            if (line) line.text += " " + word.text;
            else ocrLines.set(word.line, { text: word.text, top: word.top, left: word.left });
        }
        text = [...ocrLines.values(), ...nativeLayout].sort((left, right) => left.top - right.top || left.left - right.left)
            .map(line => line.text).join("\n");
        return { outcome: "extracted", method: "ocr", text, reason: null };
    } finally {
        factory.destroy(surface);
    }
}

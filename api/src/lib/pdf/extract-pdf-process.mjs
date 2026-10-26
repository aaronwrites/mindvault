// Isolated parser: receives retained bytes on stdin, emits one JSON result.
// No Source URLs, passwords, scripting, rendering, or remote font loading.
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

const limits = JSON.parse(process.argv[2]);
try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
        bytes += chunk.length;
        if (bytes > limits.maximumBytes) throw new Error("PDF processing byte limit exceeded; no pages were processed");
        chunks.push(chunk);
    }
    const task = getDocument({ data: new Uint8Array(Buffer.concat(chunks)), isEvalSupported: false, useWorkerFetch: false, useSystemFonts: false, disableFontFace: true, stopAtErrors: true, maxImageSize: 16_000_000, verbosity: 0 });
    const document = await task.promise;
    if (document.numPages > limits.maximumPages) throw new Error(`PDF page limit exceeded (${document.numPages} pages; limit ${limits.maximumPages}); no pages were processed`);
    const permissions = await document.getPermissions();
    if (permissions) throw new Error("PDF is encrypted; password and restriction workflows are not supported");
    const labels = await document.getPageLabels();
    const pages = [];
    let characters = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        const evidence = { pageNumber, pageLabel: labels?.[pageNumber - 1] ?? null, method: "none", outcome: "failed", text: "", reason: null };
        try {
            const page = await document.getPage(pageNumber);
            const content = await page.getTextContent();
            let text = "";
            let y;
            for (const item of content.items) {
                if (!("str" in item)) continue;
                if (y !== undefined && Math.abs(item.transform[5] - y) > 2 && !text.endsWith("\n")) text += "\n";
                text += item.str + (item.hasEOL ? "\n" : " ");
                y = item.transform[5];
                if (text.length + characters > limits.maximumCharacters) throw new Error("PDF text limit exceeded; document was not indexed");
            }
            text = text.replace(/[^\S\n]+/gu, " ").replace(/ *\n */gu, "\n").replace(/\n{3,}/gu, "\n\n").trim();
            // Reject garbled or label-only output as insufficient native evidence.
            const readable = (text.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 30 && !text.includes("\uFFFD") && text.split(/\s+/u).length >= 5;
            if (readable) {
                Object.assign(evidence, { text, method: "native", outcome: "extracted" });
                characters += text.length;
            } else {
                const operations = await page.getOperatorList();
                const emptyTextSetup = new Set([OPS.beginText, OPS.endText, OPS.setFont, OPS.setTextMatrix, OPS.setCharSpacing, OPS.setWordSpacing, OPS.setHScale, OPS.setLeading, OPS.setTextRenderingMode, OPS.setTextRise, OPS.dependency]);
                const hasMarks = operations.fnArray.some((op, index) => !emptyTextSetup.has(op)
                    && !(op === OPS.transform && JSON.stringify(operations.argsArray[index]) === "[1,0,0,1,0,0]"));
                Object.assign(evidence, hasMarks || text ? { outcome: "needs-ocr", reason: "No trustworthy selectable text; OCR is required" } : { outcome: "blank" });
            }
            page.cleanup();
        } catch (error) {
            if (error.message.includes("limit exceeded")) throw error;
            evidence.reason = `Page ${pageNumber} could not be read`;
        }
        pages.push(evidence);
    }
    if (!pages.some(page => page.outcome === "extracted")) throw new Error("PDF contains no trustworthy selectable text; OCR may be required");
    process.stdout.write(JSON.stringify({ pageCount: document.numPages, pages }));
    await task.destroy();
} catch (error) {
    const message = error.name === "PasswordException" ? "PDF is encrypted or requires a password; password entry is not supported"
        : error.name === "InvalidPDFException" ? "PDF is malformed or unreadable" : error.message;
    process.stderr.write(`MINDVAULT_PDF_ERROR: ${message}`);
    process.exitCode = 1;
}

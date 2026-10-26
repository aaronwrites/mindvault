import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";
import { captures, extractedSources, knowledgeItems, originalFiles, processingAttempts, sources } from "../../db/schema";
import type { ClaimedProcessingStage } from "../../worker";
import type { OriginalFileStorage } from "../original-files/original-file-storage";
import { completeCurrentStage, withCurrentLease } from "../sources/extract-public-textual-source";
import { extractPdf, type PdfProcessingLimits } from "./extract-pdf";

export async function processRetainedPdf(database: NodePgDatabase<typeof schema>, stage: ClaimedProcessingStage, storage: OriginalFileStorage, limits: PdfProcessingLimits) {
    const [source] = await database.select({ file: originalFiles, kind: sources.sourceKind })
        .from(processingAttempts).innerJoin(knowledgeItems, eq(knowledgeItems.id, processingAttempts.knowledgeItemId))
        .innerJoin(sources, eq(sources.id, knowledgeItems.sourceId))
        .innerJoin(originalFiles, eq(originalFiles.sourceId, sources.id))
        .where(and(eq(processingAttempts.id, stage.processingAttemptId), eq(knowledgeItems.lifecycleState, "active")));
    if (!source || source.kind !== "pdf" || source.file.storageState !== "stored" || !source.file.storageLocator) throw new Error("Retained PDF is unavailable for processing");
    if (source.file.storageProvider !== storage.provider) throw new Error("Retained PDF storage provider is unavailable");
    if (source.file.byteSize > limits.maximumBytes) throw new Error("PDF processing byte limit exceeded; no pages were processed");
    const bytes = await storage.read({ locator: source.file.storageLocator, maximumBytes: limits.maximumBytes, timeoutMs: limits.timeoutMs });
    if (createHash("sha256").update(bytes).digest("hex") !== source.file.contentHash) throw new Error("Retained PDF bytes failed integrity verification; retry storage access");
    const pdfEvidence = await extractPdf(bytes, limits);
    const [capture] = await database.select({ filename: captures.submittedFilename }).from(captures)
        .where(eq(captures.sourceId, source.file.sourceId)).orderBy(desc(captures.id)).limit(1);
    const title = capture?.filename ?? "Retained PDF";
    const completed = await withCurrentLease(database, stage, async transaction => {
        await transaction.insert(extractedSources).values({
            processingAttemptId: stage.processingAttemptId,
            sourceId: source.file.sourceId,
            title,
            evidenceText: pdfEvidence.pages.filter(page => page.outcome === "extracted").map(page => page.text).join("\n\n"),
            evidenceCoverage: "primary-content",
            pdfEvidence,
            originalUrl: null,
            finalUrl: null,
            permanentRedirects: [],
            sourcePreview: { title, description: null, websiteName: null, author: null, publishedAt: null, contentType: "application/pdf", previewImageUrl: null, previewImageAlt: null, faviconUrl: null },
        }).onConflictDoNothing();
        await completeCurrentStage(transaction, stage);
        return true;
    });
    return completed ? { completed: true as const } : undefined;
}

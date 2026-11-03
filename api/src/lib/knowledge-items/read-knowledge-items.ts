import { pdfExtractionCoverage, type PdfExtractionCoverage } from "../pdf/pdf-extraction-disclosure";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";
import { isRequiredRetrievalStage } from "../processing/stages";
import type { EmbeddingProvider } from "../ai/providers";
import type { ExtractedSourcePreview } from "../sources/extract-source-preview";
import {
    captureContexts,
    captures,
    extractedSources,
    knowledgeItems,
    passageEmbeddings,
    passages,
    processingAttempts,
    processingStages,
    recognitionSummaries,
    sourceSnapshots,
    sourcePreviews,
    sourcePreviewMedia,
    sources,
    webpageSources,
    originalFiles,
    originalFileOperations,
    knowledgeItemTopicTags,
    topicTagCorrections,
    topicTags,
    type EvidenceCoverage,
} from "../../db/schema";
import { originalFileActions } from "../original-files/create-original-file-access";

type Database = NodePgDatabase<typeof schema>;

export type KnowledgeItemAvailability = "processing" | "ready" | "unsupported" | "needs-attention";

export type KnowledgeItemView = {
    title: string;
    customTitle: string | null;
    id: number;
    createdAt: string;
    lifecycleState: "active" | "trashed" | "pending-permanent-deletion";
    trashedAt: string | null;
    deletion: { status: "pending" | "running" | "failed"; failureReason: string | null } | null;
    source: {
        id: number;
        kind: string;
        submittedUrl?: string;
        normalizedUrl?: string;
        filename?: string | null;
        mediaType?: string;
        byteSize?: number;
        originalFileActions?: { open?: string; download: string };
    };
    sourcePreview: {
        title: string;
        description: string | null;
        websiteName: string | null;
        author: string | null;
        publishedAt: string | null;
        contentType: string | null;
        previewImageUrl: string | null;
        previewImageAlt: string | null;
        previewImagePresentation: "cover" | "icon" | null;
        faviconUrl: string | null;
    } | null;
    evidenceCoverage: EvidenceCoverage | null;
    extractionCoverage?: PdfExtractionCoverage | null;
    captureContexts: Array<{ kind: string; summary: string }>;
    availability: KnowledgeItemAvailability;
    organizationCondition: "processing" | "complete" | "incomplete";
    recognitionSummary: string | null;
    topicTags: string[];
    latestAttempt: {
        id: number;
        kind: string;
        status: string;
        createdAt: string;
        failureReason?: string;
        warnings?: string[];
    } | null;
};

export async function listKnowledgeItems(database: Database, embeddingRepresentation: EmbeddingProvider["representation"], lifecycleState: "active" | "trashed" = "active"): Promise<KnowledgeItemView[]> {
    // Enrichment commits must not race the status that tells clients to stop polling.
    return database.transaction(async database => {
        const rows = await database
            .select({ knowledgeItem: knowledgeItems, source: sources, webpageSource: webpageSources, originalFile: originalFiles })
            .from(knowledgeItems)
            .innerJoin(sources, eq(knowledgeItems.sourceId, sources.id))
            .leftJoin(webpageSources, eq(webpageSources.sourceId, sources.id))
            .leftJoin(originalFiles, eq(originalFiles.sourceId, sources.id))
            .where(lifecycleState === "trashed" ? inArray(knowledgeItems.lifecycleState, ["trashed", "pending-permanent-deletion"]) : eq(knowledgeItems.lifecycleState, lifecycleState))
            .orderBy(desc(knowledgeItems.createdAt));

        return presentKnowledgeItems(database, rows, embeddingRepresentation);
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function getKnowledgeItem(database: Database, id: number, embeddingRepresentation: EmbeddingProvider["representation"]): Promise<KnowledgeItemView | undefined> {
    // Enrichment commits must not race the status that tells clients to stop polling.
    return database.transaction(async database => {
        const rows = await database
            .select({ knowledgeItem: knowledgeItems, source: sources, webpageSource: webpageSources, originalFile: originalFiles })
            .from(knowledgeItems)
            .innerJoin(sources, eq(knowledgeItems.sourceId, sources.id))
            .leftJoin(webpageSources, eq(webpageSources.sourceId, sources.id))
            .leftJoin(originalFiles, eq(originalFiles.sourceId, sources.id))
            .where(and(eq(knowledgeItems.id, id), eq(knowledgeItems.lifecycleState, "active")));

        return (await presentKnowledgeItems(database, rows, embeddingRepresentation))[0];
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

async function presentKnowledgeItems(
    database: Database,
    rows: Array<{ knowledgeItem: typeof knowledgeItems.$inferSelect; source: typeof sources.$inferSelect; webpageSource: typeof webpageSources.$inferSelect | null; originalFile: typeof originalFiles.$inferSelect | null }>,
    embeddingRepresentation: EmbeddingProvider["representation"],
): Promise<KnowledgeItemView[]> {
    if (rows.length === 0) return [];

    const itemIds = rows.map(row => row.knowledgeItem.id);
    const currentSnapshotIds = rows.flatMap(row => row.source.currentSnapshotId === null ? [] : [row.source.currentSnapshotId]);
    const [contextRows, attemptRows, summaryRows, topicTagRows, previewRows, previewMediaRows, currentSnapshotRows, extractedPreviewRows, deletionRows] = [
        await database
            .select({ knowledgeItemId: captures.knowledgeItemId, kind: captureContexts.kind, text: captureContexts.text })
            .from(captureContexts)
            .innerJoin(captures, eq(captureContexts.captureId, captures.id))
            .where(inArray(captures.knowledgeItemId, itemIds))
            .orderBy(captureContexts.id),
        await database
            .select()
            .from(processingAttempts)
            .where(inArray(processingAttempts.knowledgeItemId, itemIds))
            .orderBy(desc(processingAttempts.createdAt), desc(processingAttempts.id)),
        await database.select({ knowledgeItemId: recognitionSummaries.knowledgeItemId, sourceSnapshotId: recognitionSummaries.sourceSnapshotId, text: recognitionSummaries.text })
            .from(recognitionSummaries)
            .where(inArray(recognitionSummaries.knowledgeItemId, itemIds)),
        await database.select({ knowledgeItemId: knowledgeItemTopicTags.knowledgeItemId, sourceSnapshotId: knowledgeItemTopicTags.sourceSnapshotId, canonicalName: topicTags.canonicalName })
            .from(knowledgeItemTopicTags)
            .innerJoin(topicTags, eq(topicTags.id, knowledgeItemTopicTags.topicTagId))
            .where(inArray(knowledgeItemTopicTags.knowledgeItemId, itemIds))
            .orderBy(topicTags.canonicalName),
        currentSnapshotIds.length === 0 ? [] : await database.select().from(sourcePreviews)
            .where(inArray(sourcePreviews.sourceSnapshotId, currentSnapshotIds)),
        currentSnapshotIds.length === 0 ? [] : await database.select({ sourceSnapshotId: sourcePreviewMedia.sourceSnapshotId, alternativeText: sourcePreviewMedia.alternativeText, presentation: sourcePreviewMedia.presentation }).from(sourcePreviewMedia)
            .where(inArray(sourcePreviewMedia.sourceSnapshotId, currentSnapshotIds)),
        currentSnapshotIds.length === 0 ? [] : await database.select({ id: sourceSnapshots.id, evidenceCoverage: sourceSnapshots.evidenceCoverage, pdfEvidence: sourceSnapshots.pdfEvidence }).from(sourceSnapshots)
            .where(inArray(sourceSnapshots.id, currentSnapshotIds)),
        await database.select({ sourceId: extractedSources.sourceId, sourcePreview: extractedSources.sourcePreview })
            .from(extractedSources)
            .where(inArray(extractedSources.sourceId, rows.map(row => row.source.id)))
            .orderBy(desc(extractedSources.extractedAt), desc(extractedSources.id)),
        await database.select({ sourceId: originalFileOperations.originalFileSourceId, status: originalFileOperations.status, failureReason: originalFileOperations.failureReason }).from(originalFileOperations)
            .where(and(inArray(originalFileOperations.originalFileSourceId, rows.map(row => row.source.id)), eq(originalFileOperations.kind, "delete"))),
    ];

    const contextsByItem = new Map<number, Array<{ kind: string; summary: string }>>();
    for (const context of contextRows) {
        const contexts = contextsByItem.get(context.knowledgeItemId) ?? [];
        contexts.push({ kind: context.kind, summary: summarize(context.text) });
        contextsByItem.set(context.knowledgeItemId, contexts);
    }
    const filenameRows = await database.select({ knowledgeItemId: captures.knowledgeItemId, filename: captures.submittedFilename })
        .from(captures).where(inArray(captures.knowledgeItemId, itemIds)).orderBy(captures.id);
    const filenamesByItem = new Map<number, string | null>();
    for (const capture of filenameRows) if (capture.filename !== null) filenamesByItem.set(capture.knowledgeItemId, capture.filename);

    const latestAttempts = new Map<number, typeof processingAttempts.$inferSelect>();
    for (const attempt of attemptRows) {
        if (!latestAttempts.has(attempt.knowledgeItemId)) latestAttempts.set(attempt.knowledgeItemId, attempt);
    }
    const summariesByItem = new Map(summaryRows.map(summary => [summary.knowledgeItemId, summary]));
    const previewsBySnapshot = new Map(previewRows.map(preview => [preview.sourceSnapshotId, preview]));
    const mediaBySnapshot = new Map(previewMediaRows.map(media => [media.sourceSnapshotId, media]));
    const coverageBySnapshot = new Map(currentSnapshotRows.map(snapshot => [snapshot.id, snapshot.evidenceCoverage]));
    const pdfEvidenceBySnapshot = new Map(currentSnapshotRows.map(snapshot => [snapshot.id, snapshot.pdfEvidence]));
    const extractedPreviewsBySource = new Map<number, ExtractedSourcePreview>();
    for (const extractedPreview of extractedPreviewRows) {
        if (!extractedPreviewsBySource.has(extractedPreview.sourceId)) {
            extractedPreviewsBySource.set(extractedPreview.sourceId, extractedPreview.sourcePreview as ExtractedSourcePreview);
        }
    }
    const topicTagsByItem = new Map<number, string[]>();
    const deletionBySource = new Map(deletionRows.map(deletion => [deletion.sourceId, deletion]));
    for (const tag of topicTagRows) {
        const tags = topicTagsByItem.get(tag.knowledgeItemId) ?? [];
        tags.push(tag.canonicalName);
        topicTagsByItem.set(tag.knowledgeItemId, tags);
    }

    const generatedTopicTagsByItem = new Map(topicTagsByItem);
    const corrections = await database.select({ knowledgeItemId: topicTagCorrections.knowledgeItemId, canonicalName: topicTags.canonicalName, choice: topicTagCorrections.choice })
        .from(topicTagCorrections).innerJoin(topicTags, eq(topicTags.id, topicTagCorrections.topicTagId))
        .where(inArray(topicTagCorrections.knowledgeItemId, itemIds));
    for (const correction of corrections) {
        const tags = new Set(topicTagsByItem.get(correction.knowledgeItemId) ?? []);
        if (correction.choice === "added") tags.add(correction.canonicalName);
        else tags.delete(correction.canonicalName);
        topicTagsByItem.set(correction.knowledgeItemId, [...tags].sort());
    }

    const availabilityByItem = await availabilityByKnowledgeItem(database, rows, latestAttempts, embeddingRepresentation);
    const displayedLatestAttemptStatuses = await latestAttemptStatuses(database, latestAttempts);
    const organizationConditions = await organizationConditionsByKnowledgeItem(database, rows, attemptRows, latestAttempts, generatedTopicTagsByItem);

    return rows.map(({ knowledgeItem, source, webpageSource, originalFile }) => {
        const latestAttempt = latestAttempts.get(knowledgeItem.id);
        const pdfEvidence = source.currentSnapshotId ? pdfEvidenceBySnapshot.get(source.currentSnapshotId) : null;
        const accessActions = originalFile && knowledgeItem.lifecycleState !== "pending-permanent-deletion"
            ? originalFileActions(knowledgeItem.id, originalFile.storageState, originalFile.detectedSourceKind, originalFile.detectedMediaType)
            : undefined;
        const sourcePreview = source.currentSnapshotId === null
            ? extractedPreviewFor(extractedPreviewsBySource.get(source.id))
            : previewFor(previewsBySnapshot.get(source.currentSnapshotId), mediaBySnapshot.get(source.currentSnapshotId));
        const filename = filenamesByItem.get(knowledgeItem.id)?.split(/[\\/]/).at(-1)?.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
        const sourceTitle = sourcePreview?.title ?? (originalFile
            ? filename || `${source.sourceKind === "pdf" ? "PDF" : source.sourceKind} file`
            : webpageSource ? new URL(webpageSource.submittedUrl).hostname : "Saved item");
        return {
            title: knowledgeItem.customTitle ?? sourceTitle,
            customTitle: knowledgeItem.customTitle,
            id: knowledgeItem.id,
            createdAt: toIsoString(knowledgeItem.createdAt),
            lifecycleState: knowledgeItem.lifecycleState as KnowledgeItemView["lifecycleState"],
            trashedAt: knowledgeItem.trashedAt ? toIsoString(knowledgeItem.trashedAt) : null,
            deletion: knowledgeItem.lifecycleState === "pending-permanent-deletion" ? (() => {
                const deletion = deletionBySource.get(source.id);
                return deletion ? { status: deletion.status as "pending" | "running" | "failed", failureReason: deletion.failureReason } : { status: "pending" as const, failureReason: null };
            })() : null,
            source: {
                id: source.id,
                kind: source.sourceKind,
                ...(webpageSource ? { submittedUrl: webpageSource.submittedUrl, normalizedUrl: webpageSource.normalizedUrl } : {}),
                ...(originalFile ? { filename: filenamesByItem.get(knowledgeItem.id) ?? null, mediaType: originalFile.detectedMediaType, byteSize: originalFile.byteSize, ...(accessActions ? { originalFileActions: accessActions } : {}) } : {}),
            },
            sourcePreview,
            evidenceCoverage: source.currentSnapshotId === null
                ? null
                : coverageBySnapshot.get(source.currentSnapshotId) ?? null,
            ...(pdfEvidence ? { extractionCoverage: pdfExtractionCoverage(pdfEvidence) } : {}),
            captureContexts: contextsByItem.get(knowledgeItem.id) ?? [],
            availability: availabilityByItem.get(knowledgeItem.id) ?? "processing",
            organizationCondition: source.provenanceKind === "original-file" && source.sourceKind !== "pdf" ? "complete" : organizationConditions.get(knowledgeItem.id) ?? "processing",
            recognitionSummary: summariesByItem.get(knowledgeItem.id)?.text ?? null,
            topicTags: topicTagsByItem.get(knowledgeItem.id) ?? [],
            latestAttempt: latestAttempt ? {
                id: latestAttempt.id,
                kind: latestAttempt.kind,
                status: displayedLatestAttemptStatuses.get(latestAttempt.id)?.status ?? latestAttempt.status,
                createdAt: toIsoString(latestAttempt.createdAt),
                ...((displayedLatestAttemptStatuses.get(latestAttempt.id)?.warnings.length ?? 0) > 0 ? { warnings: displayedLatestAttemptStatuses.get(latestAttempt.id)!.warnings } : {}),
                ...(latestAttempt.failureReason ? { failureReason: latestAttempt.failureReason } : {}),
            } : null,
        };
    });
}

function extractedPreviewFor(preview: ExtractedSourcePreview | undefined): KnowledgeItemView["sourcePreview"] {
    if (!preview) return null;
    return {
        title: preview.title,
        description: preview.description,
        websiteName: preview.websiteName,
        author: preview.author,
        publishedAt: preview.publishedAt,
        contentType: preview.contentType,
        previewImageUrl: null,
        previewImageAlt: null,
        previewImagePresentation: null,
        faviconUrl: preview.faviconUrl,
    };
}

function previewFor(
    preview: typeof sourcePreviews.$inferSelect | undefined,
    media: { sourceSnapshotId: number; alternativeText: string | null; presentation: "cover" | "icon" } | undefined,
): KnowledgeItemView["sourcePreview"] {
    if (!preview) return null;
    return {
        title: preview.title,
        description: preview.description,
        websiteName: preview.websiteName,
        author: preview.author,
        publishedAt: preview.publishedAt ? toIsoString(preview.publishedAt) : null,
        contentType: preview.contentType,
        // Media can be upgraded from an icon fallback to the extracted cover
        // image without changing the Snapshot id. Include its role in the URL
        // so an immutable browser cache cannot keep serving the old fallback.
        previewImageUrl: media ? `/source-preview-media/${preview.sourceSnapshotId}?presentation=${media.presentation}` : null,
        previewImageAlt: media?.alternativeText ?? null,
        previewImagePresentation: media?.presentation ?? null,
        faviconUrl: preview.faviconUrl,
    };
}

async function organizationConditionsByKnowledgeItem(
    database: Database,
    rows: Array<{ knowledgeItem: typeof knowledgeItems.$inferSelect; source: typeof sources.$inferSelect; webpageSource: typeof webpageSources.$inferSelect | null; originalFile: typeof originalFiles.$inferSelect | null }>,
    attempts: Array<typeof processingAttempts.$inferSelect>,
    latestAttempts: Map<number, typeof processingAttempts.$inferSelect>,
    currentTopicTagsByItem: Map<number, string[]>,
): Promise<Map<number, KnowledgeItemView["organizationCondition"]>> {
    if (attempts.length === 0) return new Map();
    const stages = await database.select({ processingAttemptId: processingStages.processingAttemptId, status: processingStages.status })
        .from(processingStages)
        .where(and(
            inArray(processingStages.processingAttemptId, attempts.map(attempt => attempt.id)),
            eq(processingStages.kind, "topic-tag-generation"),
        ));
    const topicStageByAttempt = new Map(stages.map(stage => [stage.processingAttemptId, stage.status]));
    const hasFailedTopicTagStageByItem = new Set(attempts.flatMap(attempt =>
        topicStageByAttempt.get(attempt.id) === "failed" ? [attempt.knowledgeItemId] : [],
    ));
    const conditionByItem = new Map([...latestAttempts.values()].map(attempt => {
        const stageStatus = topicStageByAttempt.get(attempt.id);
        const condition: KnowledgeItemView["organizationCondition"] = stageStatus === "failed"
            ? "incomplete"
            : stageStatus === "skipped"
                ? "complete"
                : attempt.status === "failed" && hasFailedTopicTagStageByItem.has(attempt.knowledgeItemId)
                    ? "incomplete"
                : "processing";
        return [attempt.knowledgeItemId, condition];
    }));
    for (const { knowledgeItem } of rows) {
        if (currentTopicTagsByItem.has(knowledgeItem.id)) conditionByItem.set(knowledgeItem.id, "complete");
    }
    return conditionByItem;
}

async function latestAttemptStatuses(
    database: Database,
    latestAttempts: Map<number, typeof processingAttempts.$inferSelect>,
): Promise<Map<number, { status: string; warnings: string[] }>> {
    const attempts = [...latestAttempts.values()];
    if (attempts.length === 0) return new Map();

    const stages = await database.select({ processingAttemptId: processingStages.processingAttemptId, kind: processingStages.kind, status: processingStages.status, failureReason: processingStages.failureReason })
        .from(processingStages)
        .where(inArray(processingStages.processingAttemptId, attempts.map(attempt => attempt.id)));
    const stagesByAttempt = new Map<number, Array<{ kind: string; status: string; failureReason: string | null }>>();
    for (const stage of stages) {
        const attemptStages = stagesByAttempt.get(stage.processingAttemptId) ?? [];
        attemptStages.push(stage);
        stagesByAttempt.set(stage.processingAttemptId, attemptStages);
    }

    return new Map(attempts.map(attempt => {
        const attemptStages = stagesByAttempt.get(attempt.id) ?? [];
        const status = attempt.status === "pending" && attemptStages.length > 0 && attemptStages.every(stage => ["completed", "skipped", "failed"].includes(stage.status))
            ? "completed"
            : attempt.status;
        return [attempt.id, { status, warnings: [...new Set(attemptStages.flatMap(stage => stage.status === "failed" && stage.failureReason ? [stage.failureReason] : []))] }];
    }));
}

async function availabilityByKnowledgeItem(
    database: Database,
    items: Array<{ knowledgeItem: typeof knowledgeItems.$inferSelect; source: typeof sources.$inferSelect; webpageSource: typeof webpageSources.$inferSelect | null; originalFile: typeof originalFiles.$inferSelect | null }>,
    latestAttempts: Map<number, typeof processingAttempts.$inferSelect>,
    embeddingRepresentation: EmbeddingProvider["representation"],
): Promise<Map<number, KnowledgeItemAvailability>> {
    const sourceIds = items.map(item => item.source.id);
    const snapshotRows = await database
        .select({ id: sourceSnapshots.id, sourceId: sourceSnapshots.sourceId })
        .from(sourceSnapshots)
        .where(inArray(sourceSnapshots.sourceId, sourceIds));
    const snapshotIds = snapshotRows.map(snapshot => snapshot.id);
    const snapshotPassages = snapshotIds.length === 0 ? [] : await database
        .select({
            id: passages.id,
            sourceSnapshotId: passages.sourceSnapshotId,
            lexicalSearch: passages.lexicalSearch,
        })
        .from(passages)
        .where(inArray(passages.sourceSnapshotId, snapshotIds));
    const indexedPassageIds = snapshotPassages.length === 0 ? new Set<number>() : new Set((await database
        .select({ passageId: passageEmbeddings.passageId })
        .from(passageEmbeddings)
        .where(and(
            inArray(passageEmbeddings.passageId, snapshotPassages.map(passage => passage.id)),
            eq(passageEmbeddings.provider, embeddingRepresentation.provider),
            eq(passageEmbeddings.model, embeddingRepresentation.model),
            eq(passageEmbeddings.dimensions, embeddingRepresentation.dimensions),
            sql`${passageEmbeddings.metadata} IS NOT DISTINCT FROM ${JSON.stringify(embeddingRepresentation.metadata)}::jsonb`,
        )))
        .map(embedding => embedding.passageId));

    const passagesBySnapshot = new Map<number, typeof snapshotPassages>();
    for (const passage of snapshotPassages) {
        if (passage.sourceSnapshotId !== null) {
            const passagesForSnapshot = passagesBySnapshot.get(passage.sourceSnapshotId) ?? [];
            passagesForSnapshot.push(passage);
            passagesBySnapshot.set(passage.sourceSnapshotId, passagesForSnapshot);
        }
    }

    const latestAttemptIds = [...latestAttempts.values()].map(attempt => attempt.id);
    const stageRows = latestAttemptIds.length === 0 ? [] : await database
        .select({ processingAttemptId: processingStages.processingAttemptId, kind: processingStages.kind, status: processingStages.status })
        .from(processingStages)
        .where(inArray(processingStages.processingAttemptId, latestAttemptIds));
    const failedAttemptIds = new Set(stageRows
        .filter(stage => isRequiredRetrievalStage(stage.kind) && stage.status === "failed")
        .map(stage => stage.processingAttemptId));

    return new Map(items.map(({ knowledgeItem, source }) => {
        const hasTrustworthyRepresentation = snapshotRows
            .filter(snapshot => snapshot.sourceId === source.id)
            .some(snapshot => {
                const passagesForSnapshot = passagesBySnapshot.get(snapshot.id) ?? [];
                return passagesForSnapshot.length > 0
                    && passagesForSnapshot.every(passage => passage.lexicalSearch !== null && indexedPassageIds.has(passage.id));
            });
        const latestAttempt = latestAttempts.get(knowledgeItem.id);
        const availability: KnowledgeItemAvailability = source.provenanceKind === "original-file" && (source.sourceKind !== "pdf" || !latestAttempt)
            ? "unsupported"
            : hasTrustworthyRepresentation
            ? "ready"
            : latestAttempt?.status === "unsupported"
                ? "unsupported"
                : latestAttempt?.status === "failed" || (latestAttempt !== undefined && failedAttemptIds.has(latestAttempt.id))
                    ? "needs-attention"
                    : "processing";
        return [knowledgeItem.id, availability];
    }));
}

function summarize(text: string): string {
    const maximumLength = 280;
    return text.length <= maximumLength ? text : `${text.slice(0, maximumLength - 1)}…`;
}

function toIsoString(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : value;
}

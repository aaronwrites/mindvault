import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";
import { isRequiredRetrievalStage } from "../processing/stages";
import type { EmbeddingProvider } from "../ai/providers";
import {
    captureContexts,
    captures,
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
    knowledgeItemTopicTags,
    topicTags,
} from "../../db/schema";

type Database = NodePgDatabase<typeof schema>;

export type KnowledgeItemAvailability = "processing" | "ready" | "unsupported" | "needs-attention";

export type KnowledgeItemView = {
    id: number;
    createdAt: string;
    source: {
        id: number;
        submittedUrl: string;
        normalizedUrl: string;
        kind: string;
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
        faviconUrl: string | null;
    } | null;
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
    } | null;
};

export async function listKnowledgeItems(database: Database, embeddingRepresentation: EmbeddingProvider["representation"]): Promise<KnowledgeItemView[]> {
    const rows = await database
        .select({ knowledgeItem: knowledgeItems, source: sources, webpageSource: webpageSources })
        .from(knowledgeItems)
        .innerJoin(sources, eq(knowledgeItems.sourceId, sources.id))
        .innerJoin(webpageSources, eq(webpageSources.sourceId, sources.id))
        .orderBy(desc(knowledgeItems.createdAt));

    return presentKnowledgeItems(database, rows, embeddingRepresentation);
}

export async function getKnowledgeItem(database: Database, id: number, embeddingRepresentation: EmbeddingProvider["representation"]): Promise<KnowledgeItemView | undefined> {
    const rows = await database
        .select({ knowledgeItem: knowledgeItems, source: sources, webpageSource: webpageSources })
        .from(knowledgeItems)
        .innerJoin(sources, eq(knowledgeItems.sourceId, sources.id))
        .innerJoin(webpageSources, eq(webpageSources.sourceId, sources.id))
        .where(eq(knowledgeItems.id, id));

    return (await presentKnowledgeItems(database, rows, embeddingRepresentation))[0];
}

async function presentKnowledgeItems(
    database: Database,
    rows: Array<{ knowledgeItem: typeof knowledgeItems.$inferSelect; source: typeof sources.$inferSelect; webpageSource: typeof webpageSources.$inferSelect }>,
    embeddingRepresentation: EmbeddingProvider["representation"],
): Promise<KnowledgeItemView[]> {
    if (rows.length === 0) return [];

    const itemIds = rows.map(row => row.knowledgeItem.id);
    const currentSnapshotIds = rows.flatMap(row => row.source.currentSnapshotId === null ? [] : [row.source.currentSnapshotId]);
    const [contextRows, attemptRows, summaryRows, topicTagRows, previewRows, previewMediaRows] = await Promise.all([
        database
            .select({ knowledgeItemId: captures.knowledgeItemId, kind: captureContexts.kind, text: captureContexts.text })
            .from(captureContexts)
            .innerJoin(captures, eq(captureContexts.captureId, captures.id))
            .where(inArray(captures.knowledgeItemId, itemIds))
            .orderBy(captureContexts.id),
        database
            .select()
            .from(processingAttempts)
            .where(inArray(processingAttempts.knowledgeItemId, itemIds))
            .orderBy(desc(processingAttempts.createdAt), desc(processingAttempts.id)),
        database.select({ knowledgeItemId: recognitionSummaries.knowledgeItemId, sourceSnapshotId: recognitionSummaries.sourceSnapshotId, text: recognitionSummaries.text })
            .from(recognitionSummaries)
            .where(inArray(recognitionSummaries.knowledgeItemId, itemIds)),
        database.select({ knowledgeItemId: knowledgeItemTopicTags.knowledgeItemId, sourceSnapshotId: knowledgeItemTopicTags.sourceSnapshotId, canonicalName: topicTags.canonicalName })
            .from(knowledgeItemTopicTags)
            .innerJoin(topicTags, eq(topicTags.id, knowledgeItemTopicTags.topicTagId))
            .where(inArray(knowledgeItemTopicTags.knowledgeItemId, itemIds))
            .orderBy(topicTags.canonicalName),
        currentSnapshotIds.length === 0 ? [] : database.select().from(sourcePreviews)
            .where(inArray(sourcePreviews.sourceSnapshotId, currentSnapshotIds)),
        currentSnapshotIds.length === 0 ? [] : database.select({ sourceSnapshotId: sourcePreviewMedia.sourceSnapshotId, alternativeText: sourcePreviewMedia.alternativeText }).from(sourcePreviewMedia)
            .where(inArray(sourcePreviewMedia.sourceSnapshotId, currentSnapshotIds)),
    ]);

    const contextsByItem = new Map<number, Array<{ kind: string; summary: string }>>();
    for (const context of contextRows) {
        const contexts = contextsByItem.get(context.knowledgeItemId) ?? [];
        contexts.push({ kind: context.kind, summary: summarize(context.text) });
        contextsByItem.set(context.knowledgeItemId, contexts);
    }

    const latestAttempts = new Map<number, typeof processingAttempts.$inferSelect>();
    for (const attempt of attemptRows) {
        if (!latestAttempts.has(attempt.knowledgeItemId)) latestAttempts.set(attempt.knowledgeItemId, attempt);
    }
    const summariesByItem = new Map(summaryRows.map(summary => [summary.knowledgeItemId, summary]));
    const previewsBySnapshot = new Map(previewRows.map(preview => [preview.sourceSnapshotId, preview]));
    const mediaBySnapshot = new Map(previewMediaRows.map(media => [media.sourceSnapshotId, media]));
    const topicTagsByItem = new Map<number, string[]>();
    for (const tag of topicTagRows) {
        const tags = topicTagsByItem.get(tag.knowledgeItemId) ?? [];
        tags.push(tag.canonicalName);
        topicTagsByItem.set(tag.knowledgeItemId, tags);
    }

    const availabilityByItem = await availabilityByKnowledgeItem(database, rows, latestAttempts, embeddingRepresentation);
    const displayedLatestAttemptStatuses = await latestAttemptStatuses(database, latestAttempts);
    const organizationConditions = await organizationConditionsByKnowledgeItem(database, rows, attemptRows, latestAttempts, topicTagsByItem);

    return rows.map(({ knowledgeItem, source, webpageSource }) => {
        const latestAttempt = latestAttempts.get(knowledgeItem.id);
        return {
            id: knowledgeItem.id,
            createdAt: toIsoString(knowledgeItem.createdAt),
            source: {
                id: source.id,
                submittedUrl: webpageSource.submittedUrl,
                normalizedUrl: webpageSource.normalizedUrl,
                kind: source.sourceKind,
            },
            sourcePreview: source.currentSnapshotId === null ? null : previewFor(previewsBySnapshot.get(source.currentSnapshotId), mediaBySnapshot.get(source.currentSnapshotId)),
            captureContexts: contextsByItem.get(knowledgeItem.id) ?? [],
            availability: availabilityByItem.get(knowledgeItem.id) ?? "processing",
            organizationCondition: organizationConditions.get(knowledgeItem.id) ?? "processing",
            recognitionSummary: summariesByItem.get(knowledgeItem.id)?.text ?? null,
            topicTags: topicTagsByItem.get(knowledgeItem.id) ?? [],
            latestAttempt: latestAttempt ? {
                id: latestAttempt.id,
                kind: latestAttempt.kind,
                status: displayedLatestAttemptStatuses.get(latestAttempt.id) ?? latestAttempt.status,
                createdAt: toIsoString(latestAttempt.createdAt),
                ...(latestAttempt.failureReason ? { failureReason: latestAttempt.failureReason } : {}),
            } : null,
        };
    });
}

function previewFor(
    preview: typeof sourcePreviews.$inferSelect | undefined,
    media: { sourceSnapshotId: number; alternativeText: string | null } | undefined,
): KnowledgeItemView["sourcePreview"] {
    if (!preview) return null;
    return {
        title: preview.title,
        description: preview.description,
        websiteName: preview.websiteName,
        author: preview.author,
        publishedAt: preview.publishedAt ? toIsoString(preview.publishedAt) : null,
        contentType: preview.contentType,
        previewImageUrl: media ? `/source-preview-media/${preview.sourceSnapshotId}` : null,
        previewImageAlt: media?.alternativeText ?? null,
        faviconUrl: preview.faviconUrl,
    };
}

async function organizationConditionsByKnowledgeItem(
    database: Database,
    rows: Array<{ knowledgeItem: typeof knowledgeItems.$inferSelect; source: typeof sources.$inferSelect; webpageSource: typeof webpageSources.$inferSelect }>,
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
            : stageStatus === "completed" || stageStatus === "skipped"
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
): Promise<Map<number, string>> {
    const attempts = [...latestAttempts.values()];
    if (attempts.length === 0) return new Map();

    const stages = await database.select({ processingAttemptId: processingStages.processingAttemptId, kind: processingStages.kind, status: processingStages.status })
        .from(processingStages)
        .where(inArray(processingStages.processingAttemptId, attempts.map(attempt => attempt.id)));
    const stagesByAttempt = new Map<number, Array<{ kind: string; status: string }>>();
    for (const stage of stages) {
        const attemptStages = stagesByAttempt.get(stage.processingAttemptId) ?? [];
        attemptStages.push(stage);
        stagesByAttempt.set(stage.processingAttemptId, attemptStages);
    }

    return new Map(attempts.map(attempt => {
        const requiredStages = (stagesByAttempt.get(attempt.id) ?? []).filter(stage => isRequiredRetrievalStage(stage.kind));
        const status = attempt.status === "pending" && requiredStages.length > 0 && requiredStages.every(stage => stage.status === "completed")
            ? "completed"
            : attempt.status;
        return [attempt.id, status];
    }));
}

async function availabilityByKnowledgeItem(
    database: Database,
    items: Array<{ knowledgeItem: typeof knowledgeItems.$inferSelect; source: typeof sources.$inferSelect; webpageSource: typeof webpageSources.$inferSelect }>,
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
        const availability: KnowledgeItemAvailability = hasTrustworthyRepresentation
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

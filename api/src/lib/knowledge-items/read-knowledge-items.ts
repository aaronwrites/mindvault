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
    sourceSnapshots,
    sources,
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
        .select({ knowledgeItem: knowledgeItems, source: sources })
        .from(knowledgeItems)
        .innerJoin(sources, eq(knowledgeItems.sourceId, sources.id))
        .orderBy(desc(knowledgeItems.createdAt));

    return presentKnowledgeItems(database, rows, embeddingRepresentation);
}

export async function getKnowledgeItem(database: Database, id: number, embeddingRepresentation: EmbeddingProvider["representation"]): Promise<KnowledgeItemView | undefined> {
    const rows = await database
        .select({ knowledgeItem: knowledgeItems, source: sources })
        .from(knowledgeItems)
        .innerJoin(sources, eq(knowledgeItems.sourceId, sources.id))
        .where(eq(knowledgeItems.id, id));

    return (await presentKnowledgeItems(database, rows, embeddingRepresentation))[0];
}

async function presentKnowledgeItems(
    database: Database,
    rows: Array<{ knowledgeItem: typeof knowledgeItems.$inferSelect; source: typeof sources.$inferSelect }>,
    embeddingRepresentation: EmbeddingProvider["representation"],
): Promise<KnowledgeItemView[]> {
    if (rows.length === 0) return [];

    const itemIds = rows.map(row => row.knowledgeItem.id);
    const [contextRows, attemptRows] = await Promise.all([
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

    const availabilityByItem = await availabilityByKnowledgeItem(database, rows, latestAttempts, embeddingRepresentation);

    return rows.map(({ knowledgeItem, source }) => {
        const latestAttempt = latestAttempts.get(knowledgeItem.id);
        return {
            id: knowledgeItem.id,
            createdAt: toIsoString(knowledgeItem.createdAt),
            source: {
                id: source.id,
                submittedUrl: source.submittedUrl,
                normalizedUrl: source.normalizedUrl,
                kind: source.sourceKind,
            },
            captureContexts: contextsByItem.get(knowledgeItem.id) ?? [],
            availability: availabilityByItem.get(knowledgeItem.id) ?? "processing",
            organizationCondition: "processing",
            recognitionSummary: null,
            topicTags: [],
            latestAttempt: latestAttempt ? {
                id: latestAttempt.id,
                kind: latestAttempt.kind,
                status: latestAttempt.status,
                createdAt: toIsoString(latestAttempt.createdAt),
                ...(latestAttempt.failureReason ? { failureReason: latestAttempt.failureReason } : {}),
            } : null,
        };
    });
}

async function availabilityByKnowledgeItem(
    database: Database,
    items: Array<{ knowledgeItem: typeof knowledgeItems.$inferSelect; source: typeof sources.$inferSelect }>,
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

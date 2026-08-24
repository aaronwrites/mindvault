import { desc, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";
import {
    captureContexts,
    captures,
    knowledgeItems,
    processingAttempts,
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
    } | null;
};

export async function listKnowledgeItems(database: Database): Promise<KnowledgeItemView[]> {
    const rows = await database
        .select({ knowledgeItem: knowledgeItems, source: sources })
        .from(knowledgeItems)
        .innerJoin(sources, eq(knowledgeItems.sourceId, sources.id))
        .orderBy(desc(knowledgeItems.createdAt));

    return presentKnowledgeItems(database, rows);
}

export async function getKnowledgeItem(database: Database, id: number): Promise<KnowledgeItemView | undefined> {
    const rows = await database
        .select({ knowledgeItem: knowledgeItems, source: sources })
        .from(knowledgeItems)
        .innerJoin(sources, eq(knowledgeItems.sourceId, sources.id))
        .where(eq(knowledgeItems.id, id));

    return (await presentKnowledgeItems(database, rows))[0];
}

async function presentKnowledgeItems(
    database: Database,
    rows: Array<{ knowledgeItem: typeof knowledgeItems.$inferSelect; source: typeof sources.$inferSelect }>,
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
            availability: availabilityFor(latestAttempt?.status),
            organizationCondition: "processing",
            recognitionSummary: null,
            topicTags: [],
            latestAttempt: latestAttempt ? {
                id: latestAttempt.id,
                kind: latestAttempt.kind,
                status: latestAttempt.status,
                createdAt: toIsoString(latestAttempt.createdAt),
            } : null,
        };
    });
}

function availabilityFor(attemptStatus: string | undefined): KnowledgeItemAvailability {
    if (attemptStatus === "unsupported") return "unsupported";
    if (attemptStatus === "failed") return "needs-attention";
    return "processing";
}

function summarize(text: string): string {
    const maximumLength = 280;
    return text.length <= maximumLength ? text : `${text.slice(0, maximumLength - 1)}…`;
}

function toIsoString(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : value;
}

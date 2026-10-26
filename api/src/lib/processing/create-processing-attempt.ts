import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";
import { extractedSources, knowledgeItems, processingAttempts, processingStages, sources } from "../../db/schema";
import { processingStageKinds, type ProcessingStageKind } from "./stages";

type Database = NodePgDatabase<typeof schema>;

export async function createProcessingAttempt(
    database: Database,
    knowledgeItemId: number,
    kind: "initial-capture" | "refresh" | "manual-retry",
    completedStageKinds: ReadonlySet<ProcessingStageKind> = new Set(),
    sourceSnapshotId?: number,
): Promise<number> {
    const [attempt] = await database.insert(processingAttempts).values({ knowledgeItemId, kind, sourceSnapshotId }).returning();
    if (!attempt) throw new Error("Processing Attempt was not created");

    const stages = new Map<ProcessingStageKind, number>();
    for (const stageKind of processingStageKinds) {
        const prerequisite = prerequisiteFor(stageKind);
        const [stage] = await database.insert(processingStages).values({
            processingAttemptId: attempt.id,
            kind: stageKind,
            prerequisiteStageId: prerequisite ? stages.get(prerequisite) : undefined,
            status: completedStageKinds.has(stageKind) ? "completed" : "pending",
        }).returning();
        if (!stage) throw new Error(`Processing stage ${stageKind} was not created`);
        stages.set(stageKind, stage.id);
    }
    return attempt.id;
}

export async function createManualRetryProcessingAttempt(database: Database, knowledgeItemId: number): Promise<number | "not-found" | "not-actionable"> {
    return database.transaction(async transaction => {
        const [knowledgeItem] = await transaction.select({ id: knowledgeItems.id })
            .from(knowledgeItems)
            .where(and(eq(knowledgeItems.id, knowledgeItemId), eq(knowledgeItems.lifecycleState, "active")));
        if (!knowledgeItem) return "not-found";

        const [failedAttempt] = await transaction.select()
            .from(processingAttempts)
            .where(eq(processingAttempts.knowledgeItemId, knowledgeItem.id))
            .orderBy(desc(processingAttempts.createdAt), desc(processingAttempts.id))
            .limit(1);
        if (!failedAttempt || failedAttempt.status !== "failed") return "not-actionable";

        const previousStages = await transaction.select({ kind: processingStages.kind, status: processingStages.status })
            .from(processingStages)
            .where(eq(processingStages.processingAttemptId, failedAttempt.id));
        const completedStageKinds = new Set(previousStages
            .filter(stage => stage.status === "completed")
            .map(stage => stage.kind as ProcessingStageKind));
        const retryAttemptId = await createProcessingAttempt(transaction, knowledgeItem.id, "manual-retry", completedStageKinds, failedAttempt.sourceSnapshotId ?? undefined);

        if (completedStageKinds.has("extraction") && !completedStageKinds.has("snapshot-persistence")) {
            const [extractedSource] = await transaction.select()
                .from(extractedSources)
                .where(eq(extractedSources.processingAttemptId, failedAttempt.id));
            if (!extractedSource) throw new Error("Manual retry could not reuse successful Extraction output");
            await transaction.insert(extractedSources).values({
                processingAttemptId: retryAttemptId,
                sourceId: extractedSource.sourceId,
                title: extractedSource.title,
                evidenceText: extractedSource.evidenceText,
                evidenceCoverage: extractedSource.evidenceCoverage,
                pdfEvidence: extractedSource.pdfEvidence,
                originalUrl: extractedSource.originalUrl,
                finalUrl: extractedSource.finalUrl,
                canonicalUrl: extractedSource.canonicalUrl,
                permanentRedirects: extractedSource.permanentRedirects,
                sourcePreview: extractedSource.sourcePreview,
                extractedAt: extractedSource.extractedAt,
            });
        }
        return retryAttemptId;
    });
}

export async function createRefreshProcessingAttempt(database: Database, knowledgeItemId: number): Promise<number | undefined> {
    return database.transaction(async transaction => {
        const [knowledgeItem] = await transaction.select({ id: knowledgeItems.id, provenanceKind: sources.provenanceKind, sourceKind: sources.sourceKind })
            .from(knowledgeItems).innerJoin(sources, eq(sources.id, knowledgeItems.sourceId))
            .where(and(eq(knowledgeItems.id, knowledgeItemId), eq(knowledgeItems.lifecycleState, "active")));
        if (!knowledgeItem || (knowledgeItem.provenanceKind === "original-file" && knowledgeItem.sourceKind !== "pdf")) return undefined;
        return createProcessingAttempt(transaction, knowledgeItem.id, "refresh");
    });
}

function prerequisiteFor(kind: ProcessingStageKind): ProcessingStageKind | undefined {
    switch (kind) {
        case "snapshot-persistence":
            return "extraction";
        case "passage-generation":
            return "snapshot-persistence";
        case "lexical-indexing":
            return "passage-generation";
        case "semantic-indexing":
            return "passage-generation";
        case "snapshot-activation":
            return "semantic-indexing";
        case "recognition-summary-generation":
        case "topic-tag-generation":
            return "snapshot-activation";
        default:
            return undefined;
    }
}

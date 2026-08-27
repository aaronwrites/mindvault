import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";
import { knowledgeItems, processingAttempts, processingStages } from "../../db/schema";
import { processingStageKinds, type ProcessingStageKind } from "./stages";

type Database = NodePgDatabase<typeof schema>;

export async function createProcessingAttempt(
    database: Database,
    knowledgeItemId: number,
    kind: "initial-capture" | "refresh" | "manual-retry",
): Promise<number> {
    const [attempt] = await database.insert(processingAttempts).values({ knowledgeItemId, kind }).returning();
    if (!attempt) throw new Error("Processing Attempt was not created");

    const stages = new Map<ProcessingStageKind, number>();
    for (const stageKind of processingStageKinds) {
        const prerequisite = prerequisiteFor(stageKind);
        const [stage] = await database.insert(processingStages).values({
            processingAttemptId: attempt.id,
            kind: stageKind,
            prerequisiteStageId: prerequisite ? stages.get(prerequisite) : undefined,
        }).returning();
        if (!stage) throw new Error(`Processing stage ${stageKind} was not created`);
        stages.set(stageKind, stage.id);
    }
    return attempt.id;
}

export async function createRefreshProcessingAttempt(database: Database, knowledgeItemId: number): Promise<number | undefined> {
    return database.transaction(async transaction => {
        const [knowledgeItem] = await transaction.select({ id: knowledgeItems.id })
            .from(knowledgeItems)
            .where(eq(knowledgeItems.id, knowledgeItemId));
        if (!knowledgeItem) return undefined;
        return createProcessingAttempt(transaction, knowledgeItem.id, "refresh");
    });
}

function prerequisiteFor(kind: ProcessingStageKind): ProcessingStageKind | undefined {
    switch (kind) {
        case "snapshot-persistence":
            return "extraction";
        case "passage-generation":
        case "recognition-summary-generation":
        case "topic-tag-generation":
            return "snapshot-persistence";
        case "lexical-indexing":
        case "semantic-indexing":
            return "passage-generation";
        default:
            return undefined;
    }
}

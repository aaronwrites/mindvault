import { and, eq, gt, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";
import { knowledgeItems, processingAttempts, processingStages, sourceSnapshots, sources } from "../../db/schema";
import type { ClaimedProcessingStage } from "../../worker";

type Database = NodePgDatabase<typeof schema>;

/**
 * Makes an indexed Source Snapshot current only after its retrieval work has
 * completed. This leaves a Ready Knowledge Item's previous representation
 * intact while a Refresh is still building a replacement.
 */
export function createSourceSnapshotActivationStageHandler(database: Database) {
    return async (stage: ClaimedProcessingStage): Promise<void> => {
        await database.transaction(async transaction => {
            const [attempt] = await transaction.select({
                sourceId: knowledgeItems.sourceId,
                sourceSnapshotId: processingAttempts.sourceSnapshotId,
            }).from(processingAttempts)
                .innerJoin(knowledgeItems, eq(knowledgeItems.id, processingAttempts.knowledgeItemId))
                .where(eq(processingAttempts.id, stage.processingAttemptId));
            if (!attempt?.sourceSnapshotId) throw new Error("Source Snapshot activation could not find the Source Snapshot produced by this Processing Attempt");

            const [lexicalStage] = await transaction.select({ status: processingStages.status })
                .from(processingStages)
                .where(and(
                    eq(processingStages.processingAttemptId, stage.processingAttemptId),
                    eq(processingStages.kind, "lexical-indexing"),
                ));
            if (lexicalStage?.status !== "completed") throw new Error("Source Snapshot activation is waiting for Lexical indexing");

            const [snapshot] = await transaction.select({ id: sourceSnapshots.id, extractedAt: sourceSnapshots.extractedAt })
                .from(sourceSnapshots)
                .where(and(eq(sourceSnapshots.id, attempt.sourceSnapshotId), eq(sourceSnapshots.sourceId, attempt.sourceId)));
            if (!snapshot) throw new Error("Source Snapshot activation could not find its Source Snapshot");

            const newerSnapshots = await transaction.select({ id: sourceSnapshots.id })
                .from(sourceSnapshots)
                .where(and(
                    eq(sourceSnapshots.sourceId, attempt.sourceId),
                    or(
                        gt(sourceSnapshots.extractedAt, snapshot.extractedAt),
                        and(eq(sourceSnapshots.extractedAt, snapshot.extractedAt), gt(sourceSnapshots.id, snapshot.id)),
                    ),
                ))
                .limit(1);
            if (newerSnapshots.length === 0) {
                await transaction.update(sources).set({ currentSnapshotId: attempt.sourceSnapshotId })
                    .where(eq(sources.id, attempt.sourceId));
            }
        });
    };
}

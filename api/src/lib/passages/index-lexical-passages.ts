import { eq } from "drizzle-orm";
import { sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";
import { knowledgeItems, processingAttempts } from "../../db/schema";
import type { ClaimedProcessingStage } from "../../worker";

type Database = NodePgDatabase<typeof schema>;

export function createLexicalIndexingStageHandler(database: Database) {
    return async (stage: ClaimedProcessingStage): Promise<void> => {
        const [attempt] = await database.select({
            knowledgeItemId: processingAttempts.knowledgeItemId,
            sourceSnapshotId: processingAttempts.sourceSnapshotId,
        }).from(processingAttempts)
            .innerJoin(knowledgeItems, eq(knowledgeItems.id, processingAttempts.knowledgeItemId))
            .where(eq(processingAttempts.id, stage.processingAttemptId));
        if (!attempt) throw new Error("Lexical indexing could not find the Processing Attempt");
        const { knowledgeItemId, sourceSnapshotId } = attempt;
        if (!sourceSnapshotId) throw new Error("Lexical indexing could not find the Source Snapshot produced by this Processing Attempt");

        const eligiblePassages = passagesEligibleForLexicalIndex({ knowledgeItemId, sourceSnapshotId });
        await database.execute(sql`
            UPDATE passages
            SET lexical_search = to_tsvector('simple', text)
            WHERE ${eligiblePassages}
              AND lexical_search IS DISTINCT FROM to_tsvector('simple', text)
        `);

        const incomplete = await database.execute(sql`
            SELECT EXISTS (
                SELECT 1
                FROM passages
                WHERE ${eligiblePassages}
                  AND lexical_search IS NULL
            ) AS incomplete
        `);
        if (incomplete.rows[0]?.incomplete) throw new Error("Lexical indexing did not complete every eligible Passage");
    };
}

function passagesEligibleForLexicalIndex(attempt: { sourceSnapshotId: number; knowledgeItemId: number }): SQL {
    return sql`(
        source_snapshot_id = ${attempt.sourceSnapshotId}
        OR capture_context_id IN (
            SELECT id FROM capture_contexts
            WHERE capture_id IN (
                SELECT id FROM captures WHERE knowledge_item_id = ${attempt.knowledgeItemId}
            )
        )
    )`;
}

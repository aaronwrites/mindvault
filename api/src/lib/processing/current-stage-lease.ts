import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";
import { processingStages } from "../../db/schema";
import type { ClaimedProcessingStage } from "../../worker";

type Database = NodePgDatabase<typeof schema>;

export async function withCurrentLease<T>(
    database: Database,
    stage: ClaimedProcessingStage,
    operation: (transaction: Parameters<Parameters<Database["transaction"]>[0]>[0]) => Promise<T>,
): Promise<T | undefined> {
    return database.transaction(async transaction => {
        const lease = await transaction.execute(sql`
            SELECT id
            FROM processing_stages
            WHERE id = ${stage.id}
              AND status = 'running'
              AND lease_token = ${stage.leaseToken}
            FOR UPDATE
        `);
        if (lease.rows.length === 0) return undefined;
        return operation(transaction);
    });
}

export async function completeCurrentStage(
    transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
    stage: ClaimedProcessingStage,
): Promise<void> {
    await transaction.update(processingStages).set({ status: "completed", leaseToken: null, leaseExpiresAt: null })
        .where(and(
            eq(processingStages.id, stage.id),
            eq(processingStages.status, "running"),
            eq(processingStages.leaseToken, stage.leaseToken),
        ));
}

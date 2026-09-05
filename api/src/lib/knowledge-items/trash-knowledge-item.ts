import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";
import { knowledgeItems } from "../../db/schema";

type Database = NodePgDatabase<typeof schema>;

export async function trashKnowledgeItem(database: Database, knowledgeItemId: number): Promise<"trashed" | "not-found"> {
    return database.transaction(async transaction => {
        const [updated] = await transaction.update(knowledgeItems)
            .set({ lifecycleState: "trashed", trashedAt: new Date(), deletionRequestedAt: null })
            .where(and(eq(knowledgeItems.id, knowledgeItemId), eq(knowledgeItems.lifecycleState, "active")))
            .returning({ id: knowledgeItems.id });
        if (updated) {
            await transaction.execute(sql`
                UPDATE processing_stages
                SET status = 'skipped', lease_token = NULL, lease_expires_at = NULL
                WHERE processing_attempt_id IN (SELECT id FROM processing_attempts WHERE knowledge_item_id = ${knowledgeItemId})
                  AND status IN ('pending', 'running')
            `);
        }
        return updated ? "trashed" : "not-found";
    });
}

export async function restoreKnowledgeItem(database: Database, knowledgeItemId: number): Promise<"restored" | "not-found"> {
    return database.transaction(async transaction => {
        const [updated] = await transaction.update(knowledgeItems)
            .set({ lifecycleState: "active", trashedAt: null, deletionRequestedAt: null })
            .where(and(eq(knowledgeItems.id, knowledgeItemId), eq(knowledgeItems.lifecycleState, "trashed")))
            .returning({ id: knowledgeItems.id });
        if (updated) return "restored";
        const [existing] = await transaction.select({ lifecycleState: knowledgeItems.lifecycleState })
            .from(knowledgeItems).where(eq(knowledgeItems.id, knowledgeItemId));
        return existing?.lifecycleState === "active" ? "restored" : "not-found";
    });
}

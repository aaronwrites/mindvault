import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Clock } from "../ai/providers";
import * as schema from "../../db/schema";
import { knowledgeItems, originalFileOperations, originalFiles, sources } from "../../db/schema";
import type { OriginalFileStorage } from "./original-file-storage";

type Database = NodePgDatabase<typeof schema>;

export type OriginalFileOperationsWorker = { runEligibleWork(): Promise<number> };

type ClaimedOperation = { id: number; sourceId: number; kind: "upload" | "delete"; locator: string | null; providerIdentity: string; attemptCount: number; leaseToken: string };

const systemClock: Clock = { now: () => new Date() };

export function createOriginalFileOperationsWorker({
    database,
    storage,
    workerId = randomUUID(),
    clock = systemClock,
    leaseDurationMs = 60_000,
    maxAttempts = 3,
    retryBaseDelayMs = 1_000,
    retryMaxDelayMs = 60_000,
}: {
    database: Database;
    storage: OriginalFileStorage;
    workerId?: string;
    clock?: Clock;
    leaseDurationMs?: number;
    maxAttempts?: number;
    retryBaseDelayMs?: number;
    retryMaxDelayMs?: number;
}): OriginalFileOperationsWorker {
    return {
        async runEligibleWork() {
            const operation = await claimOperation(database, workerId, clock.now(), leaseDurationMs);
            if (!operation) return 0;
            try {
                if (operation.kind === "delete") {
                    if (!operation.locator) throw new Error("Pending Original File deletion has no storage locator");
                    await storage.delete(operation.locator);
                    await removeDeletedOriginalFile(database, operation);
                } else {
                    const stored = await storage.inspectUpload(operation.providerIdentity);
                    if (stored) await storage.delete(stored.locator);
                    await removeUncommittedOriginalFile(database, operation);
                }
            } catch (error) {
                await rescheduleOriginalFileOperation(database, operation, clock.now(), maxAttempts, retryBaseDelayMs, retryMaxDelayMs, error);
            }
            return 1;
        },
    };
}

async function claimOperation(database: Database, workerId: string, now: Date, leaseDurationMs: number): Promise<ClaimedOperation | undefined> {
    const leaseToken = `${workerId}:${randomUUID()}`;
    const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);
    const result = await database.execute(sql<ClaimedOperation>`
        WITH eligible_operation AS (
            SELECT operation.id
            FROM original_file_operations AS operation
            INNER JOIN original_files AS file ON file.source_id = operation.original_file_source_id
            LEFT JOIN knowledge_items AS item ON item.source_id = file.source_id
            WHERE ((
                operation.kind = 'delete'
                AND item.lifecycle_state = 'pending-permanent-deletion'
                AND file.storage_state = 'pending-deletion'
              ) OR (
                operation.kind = 'upload'
                AND item.id IS NULL
              ))
              AND operation.available_at <= ${now}
              AND (operation.status = 'pending' OR (operation.status = 'running' AND operation.lease_expires_at <= ${now}))
            ORDER BY operation.available_at, operation.id
            LIMIT 1
            FOR UPDATE OF operation SKIP LOCKED
        )
        UPDATE original_file_operations AS operation
        SET status = 'running', lease_token = ${leaseToken}, lease_expires_at = ${leaseExpiresAt}, attempt_count = operation.attempt_count + 1
        FROM eligible_operation, original_files AS file
        WHERE operation.id = eligible_operation.id AND file.source_id = operation.original_file_source_id
        RETURNING operation.id, operation.original_file_source_id AS "sourceId", operation.kind, file.storage_locator AS locator, file.provider_identity AS "providerIdentity",
            operation.attempt_count AS "attemptCount", operation.lease_token AS "leaseToken"
    `);
    return result.rows[0] as ClaimedOperation | undefined;
}

async function removeUncommittedOriginalFile(database: Database, operation: ClaimedOperation): Promise<void> {
    await database.transaction(async transaction => {
        const [claimed] = await transaction.select({ id: originalFileOperations.id })
            .from(originalFileOperations)
            .where(and(eq(originalFileOperations.id, operation.id), eq(originalFileOperations.status, "running"), eq(originalFileOperations.leaseToken, operation.leaseToken)));
        if (!claimed) return;
        await transaction.execute(sql`DELETE FROM sources WHERE id = ${operation.sourceId} AND NOT EXISTS (SELECT 1 FROM knowledge_items WHERE source_id = ${operation.sourceId})`);
    });
}

async function removeDeletedOriginalFile(database: Database, operation: ClaimedOperation): Promise<void> {
    await database.transaction(async transaction => {
        const [claimed] = await transaction.select({ id: originalFileOperations.id })
            .from(originalFileOperations)
            .where(and(eq(originalFileOperations.id, operation.id), eq(originalFileOperations.status, "running"), eq(originalFileOperations.leaseToken, operation.leaseToken)));
        if (!claimed) return;
        await transaction.execute(sql`DELETE FROM processing_attempts WHERE knowledge_item_id IN (SELECT id FROM knowledge_items WHERE source_id = ${operation.sourceId})`);
        await transaction.execute(sql`DELETE FROM captures WHERE source_id = ${operation.sourceId}`);
        await transaction.execute(sql`DELETE FROM source_snapshots WHERE source_id = ${operation.sourceId}`);
        await transaction.delete(knowledgeItems).where(eq(knowledgeItems.sourceId, operation.sourceId));
        await transaction.delete(sources).where(eq(sources.id, operation.sourceId));
    });
}

async function rescheduleOriginalFileOperation(
    database: Database,
    operation: ClaimedOperation,
    now: Date,
    maxAttempts: number,
    retryBaseDelayMs: number,
    retryMaxDelayMs: number,
    error: unknown,
): Promise<void> {
    const exhausted = operation.attemptCount >= maxAttempts;
    const delayMs = Math.min(retryBaseDelayMs * 2 ** (operation.attemptCount - 1), retryMaxDelayMs);
    const reason = error instanceof Error ? error.message : `Original File ${operation.kind} reconciliation failed unexpectedly`;
    await database.update(originalFileOperations).set({
        status: exhausted ? "failed" : "pending",
        availableAt: new Date(now.getTime() + delayMs),
        leaseToken: null,
        leaseExpiresAt: null,
        failureReason: reason,
    }).where(and(eq(originalFileOperations.id, operation.id), eq(originalFileOperations.status, "running"), eq(originalFileOperations.leaseToken, operation.leaseToken)));
}

export async function requestPermanentDeletion(database: Database, knowledgeItemId: number): Promise<"pending" | "deleted" | "not-found"> {
    return database.transaction(async transaction => {
        const record = (await transaction.select({ knowledgeItem: knowledgeItems, originalFile: originalFiles })
            .from(knowledgeItems)
            .leftJoin(originalFiles, eq(originalFiles.sourceId, knowledgeItems.sourceId))
            .where(eq(knowledgeItems.id, knowledgeItemId)))[0];
        if (!record || (record.knowledgeItem.lifecycleState !== "trashed" && record.knowledgeItem.lifecycleState !== "pending-permanent-deletion")) return "not-found";

        if (!record.originalFile) {
            if (record.knowledgeItem.lifecycleState !== "trashed") return "not-found";
            await removeWebpageProvenance(transaction, record.knowledgeItem.sourceId);
            return "deleted";
        }

        await transaction.update(knowledgeItems).set({ lifecycleState: "pending-permanent-deletion", deletionRequestedAt: new Date() })
            .where(eq(knowledgeItems.id, knowledgeItemId));
        await transaction.update(originalFiles).set({ storageState: "pending-deletion" })
            .where(eq(originalFiles.sourceId, record.knowledgeItem.sourceId));
        const [existingDelete] = await transaction.select({ id: originalFileOperations.id, status: originalFileOperations.status })
            .from(originalFileOperations)
            .where(and(eq(originalFileOperations.originalFileSourceId, record.knowledgeItem.sourceId), eq(originalFileOperations.kind, "delete")));
        if (existingDelete) {
            if (existingDelete.status === "failed") await transaction.update(originalFileOperations).set({ status: "pending", availableAt: new Date(), failureReason: null, leaseToken: null, leaseExpiresAt: null })
                .where(eq(originalFileOperations.id, existingDelete.id));
        } else {
            await transaction.insert(originalFileOperations).values({ originalFileSourceId: record.knowledgeItem.sourceId, kind: "delete" });
        }
        return "pending";
    });
}

async function removeWebpageProvenance(database: Database, sourceId: number): Promise<void> {
    await database.execute(sql`DELETE FROM processing_attempts WHERE knowledge_item_id IN (SELECT id FROM knowledge_items WHERE source_id = ${sourceId})`);
    await database.execute(sql`DELETE FROM captures WHERE source_id = ${sourceId}`);
    await database.execute(sql`DELETE FROM source_snapshots WHERE source_id = ${sourceId}`);
    await database.delete(knowledgeItems).where(eq(knowledgeItems.sourceId, sourceId));
    await database.delete(sources).where(eq(sources.id, sourceId));
}

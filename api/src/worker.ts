import { randomUUID } from "node:crypto";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { db } from "./db";
import type { Clock } from "./lib/ai/providers";
import { type ProcessingStageKind } from "./lib/processing/stages";
import * as schema from "./db/schema";
type Database = NodePgDatabase<typeof schema>;

export type ClaimedProcessingStage = {
    id: number;
    processingAttemptId: number;
    kind: ProcessingStageKind;
    attemptCount: number;
};

export type ProcessingStageHandler = (stage: ClaimedProcessingStage) => Promise<void>;

export type ProcessingWorker = {
    runEligibleWork(): Promise<number>;
};

type ProcessingWorkerOptions = {
    database: Database;
    workerId?: string;
    clock?: Clock;
    leaseDurationMs?: number;
    maxAttempts?: number;
    retryBaseDelayMs?: number;
    retryMaxDelayMs?: number;
    handlers: Partial<Record<ProcessingStageKind, ProcessingStageHandler>>;
};

type ClaimedStageRow = ClaimedProcessingStage & { leaseToken: string };

const systemClock: Clock = { now: () => new Date() };
const defaultMaxAttempts = 3;
const defaultRetryBaseDelayMs = 1_000;
const defaultRetryMaxDelayMs = 60_000;

export function createProcessingWorker({
    database,
    workerId = randomUUID(),
    clock = systemClock,
    leaseDurationMs = 60_000,
    maxAttempts = defaultMaxAttempts,
    retryBaseDelayMs = defaultRetryBaseDelayMs,
    retryMaxDelayMs = defaultRetryMaxDelayMs,
    handlers,
}: ProcessingWorkerOptions): ProcessingWorker {
    return {
        async runEligibleWork(): Promise<number> {
            const claimedStage = await claimEligibleStage(database, workerId, clock.now(), leaseDurationMs, Object.keys(handlers) as ProcessingStageKind[]);
            if (!claimedStage) return 0;

            const handler = handlers[claimedStage.kind];
            if (!handler) return 0;
            try {
                await handler(claimedStage);
                await completeStage(database, claimedStage);
            } catch {
                await scheduleRetry(database, claimedStage, clock.now(), maxAttempts, retryBaseDelayMs, retryMaxDelayMs);
            }
            return 1;
        },
    };
}

export function startProcessingWorker(worker: ProcessingWorker, pollIntervalMs = 1_000): () => void {
    const interval = setInterval(() => {
        void worker.runEligibleWork().catch(error => console.error("Processing worker failed:", error));
    }, pollIntervalMs);
    return () => clearInterval(interval);
}

async function claimEligibleStage(
    database: Database,
    workerId: string,
    now: Date,
    leaseDurationMs: number,
    handledKinds: ProcessingStageKind[],
): Promise<ClaimedStageRow | undefined> {
    if (handledKinds.length === 0) return undefined;

    const leaseToken = `${workerId}:${randomUUID()}`;
    const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);
    const result = await database.execute(sql<ClaimedStageRow>`
        WITH eligible_stage AS (
            SELECT stage.id
            FROM processing_stages AS stage
            LEFT JOIN processing_stages AS prerequisite ON prerequisite.id = stage.prerequisite_stage_id
            WHERE stage.kind IN (${sql.join(handledKinds.map(kind => sql`${kind}`), sql`, `)})
              AND stage.available_at <= ${now}
              AND (
                  stage.status = 'pending'
                  OR (stage.status = 'running' AND stage.lease_expires_at <= ${now})
              )
              AND (stage.prerequisite_stage_id IS NULL OR prerequisite.status = 'completed')
            ORDER BY stage.available_at, stage.id
            LIMIT 1
            FOR UPDATE OF stage SKIP LOCKED
        )
        UPDATE processing_stages AS stage
        SET status = 'running',
            lease_token = ${leaseToken},
            lease_expires_at = ${leaseExpiresAt},
            attempt_count = stage.attempt_count + 1
        FROM eligible_stage
        WHERE stage.id = eligible_stage.id
        RETURNING stage.id, stage.processing_attempt_id AS "processingAttemptId", stage.kind,
            stage.attempt_count AS "attemptCount", stage.lease_token AS "leaseToken"
    `);
    return result.rows[0] as ClaimedStageRow | undefined;
}

async function completeStage(database: Database, stage: ClaimedStageRow): Promise<void> {
    await database.execute(sql`
        UPDATE processing_stages
        SET status = 'completed', lease_token = NULL, lease_expires_at = NULL
        WHERE id = ${stage.id}
          AND status = 'running'
          AND lease_token = ${stage.leaseToken}
    `);
}

async function scheduleRetry(
    database: Database,
    stage: ClaimedStageRow,
    now: Date,
    maxAttempts: number,
    retryBaseDelayMs: number,
    retryMaxDelayMs: number,
): Promise<void> {
    const exhausted = stage.attemptCount >= maxAttempts;
    const delayMs = Math.min(retryBaseDelayMs * 2 ** (stage.attemptCount - 1), retryMaxDelayMs);
    await database.execute(sql`
        UPDATE processing_stages
        SET status = ${exhausted ? "failed" : "pending"},
            available_at = ${new Date(now.getTime() + delayMs)},
            lease_token = NULL,
            lease_expires_at = NULL
        WHERE id = ${stage.id}
          AND status = 'running'
          AND lease_token = ${stage.leaseToken}
    `);
}

if (import.meta.main) {
    startProcessingWorker(createProcessingWorker({ database: db, handlers: {} }));
}

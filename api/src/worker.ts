import { randomUUID } from "node:crypto";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import type { Clock, EmbeddingProvider, TextGenerationProvider, TopicTagGenerationProvider } from "./lib/ai/providers";
import { createOllamaProviders } from "./lib/ai/ollama";
import { createRecognitionSummaryStageHandler } from "./lib/recognition-summaries/generate-recognition-summary";
import { createTopicTagGenerationStageHandler } from "./lib/topic-tags/generate-topic-tags";
import { isRequiredRetrievalStage, type ProcessingStageKind } from "./lib/processing/stages";
import { createExtractionStageHandler } from "./lib/sources/extract-public-textual-source";
import { createSnapshotPersistenceStageHandler } from "./lib/sources/persist-cleaned-source-snapshot";
import { createSourceSnapshotActivationStageHandler } from "./lib/sources/activate-source-snapshot";
import { createPassageGenerationStageHandler } from "./lib/passages/generate-passages";
import { createLexicalIndexingStageHandler } from "./lib/passages/index-lexical-passages";
import { createSemanticIndexingStageHandler } from "./lib/passages/index-semantic-passages";
import type { SafeFetchOptions } from "./lib/sources/fetch-public-source";
import * as schema from "./db/schema";
import { cloudinaryOriginalFileStorageFromEnvironment } from "./lib/original-files/cloudinary-original-file-storage";
import { processRetainedPdf } from "./lib/pdf/process-retained-pdf";
import { pdfProcessingLimits, type PdfProcessingLimits } from "./lib/pdf/extract-pdf";
import type { OriginalFileStorage } from "./lib/original-files/original-file-storage";
import { OriginalFileStorageError } from "./lib/original-files/original-file-storage";
import { createOriginalFileOperationsWorker } from "./lib/original-files/process-original-file-operations";
type Database = NodePgDatabase<typeof schema>;

export type ClaimedProcessingStage = {
    id: number;
    processingAttemptId: number;
    kind: ProcessingStageKind;
    attemptCount: number;
    leaseToken: string;
};

export type ProcessingStageHandler = (stage: ClaimedProcessingStage) => Promise<void | { completed: true }>;

export type ProcessingWorker = {
    runEligibleWork(): Promise<number>;
};

export type ProcessingWorkerOptions = {
    database: Database;
    workerId?: string;
    clock?: Clock;
    leaseDurationMs?: number;
    leaseRenewalIntervalMs?: number;
    maxAttempts?: number;
    retryBaseDelayMs?: number;
    retryMaxDelayMs?: number;
    handlers: Partial<Record<ProcessingStageKind, ProcessingStageHandler>>;
};

export function createArticleProcessingWorker({
    database,
    sourceFetchOptions,
    embeddingProvider,
    summaryProvider,
    topicTagProvider,
    originalFileStorage = () => cloudinaryOriginalFileStorageFromEnvironment(),
    pdfLimits = pdfProcessingLimits(),
    ...options
}: Omit<ProcessingWorkerOptions, "handlers"> & { originalFileStorage?: () => OriginalFileStorage; pdfLimits?: PdfProcessingLimits; sourceFetchOptions?: SafeFetchOptions; embeddingProvider?: EmbeddingProvider; summaryProvider?: TextGenerationProvider; topicTagProvider?: TopicTagGenerationProvider }): ProcessingWorker {
    const defaults = createOllamaProviders();
    const extractWebpage = createExtractionStageHandler(database, sourceFetchOptions);
    return createProcessingWorker({
        database,
        ...options,
        handlers: {
            extraction: async stage => {
                const [source] = await database.select({ provenanceKind: schema.sources.provenanceKind })
                    .from(schema.processingAttempts)
                    .innerJoin(schema.knowledgeItems, eq(schema.knowledgeItems.id, schema.processingAttempts.knowledgeItemId))
                    .innerJoin(schema.sources, eq(schema.sources.id, schema.knowledgeItems.sourceId))
                    .where(eq(schema.processingAttempts.id, stage.processingAttemptId));
                return source?.provenanceKind === "original-file"
                    ? processRetainedPdf(database, stage, originalFileStorage(), pdfLimits) : extractWebpage(stage);
            },
            "snapshot-persistence": createSnapshotPersistenceStageHandler(database, sourceFetchOptions),
            "passage-generation": createPassageGenerationStageHandler(database),
            "lexical-indexing": createLexicalIndexingStageHandler(database),
            "semantic-indexing": createSemanticIndexingStageHandler(database, embeddingProvider ?? defaults.embeddingProvider),
            "snapshot-activation": createSourceSnapshotActivationStageHandler(database),
            "recognition-summary-generation": createRecognitionSummaryStageHandler(database, summaryProvider ?? defaults.summaryProvider),
            "topic-tag-generation": createTopicTagGenerationStageHandler(database, topicTagProvider ?? defaults.topicTagProvider),
        },
    });
}

type ClaimedStageRow = ClaimedProcessingStage;

const systemClock: Clock = { now: () => new Date() };
const defaultMaxAttempts = 3;
const defaultRetryBaseDelayMs = 1_000;
const defaultRetryMaxDelayMs = 60_000;

export function createProcessingWorker({
    database,
    workerId = randomUUID(),
    clock = systemClock,
    leaseDurationMs = 60_000,
    leaseRenewalIntervalMs = Math.max(10, Math.floor(leaseDurationMs / 3)),
    maxAttempts = defaultMaxAttempts,
    retryBaseDelayMs = defaultRetryBaseDelayMs,
    retryMaxDelayMs = defaultRetryMaxDelayMs,
    handlers,
}: ProcessingWorkerOptions): ProcessingWorker {
    let running = false;
    return {
        async runEligibleWork(): Promise<number> {
            if (running) return 0;
            running = true;
            try {
                const claimedStage = await claimEligibleStage(database, workerId, clock.now(), leaseDurationMs, Object.keys(handlers) as ProcessingStageKind[]);
                if (!claimedStage) return 0;

                const handler = handlers[claimedStage.kind];
                if (!handler) return 0;
                const lease = startLeaseRenewal(database, claimedStage, clock, leaseDurationMs, leaseRenewalIntervalMs);
                try {
                    const outcome = await handler(claimedStage);
                    await lease.stop();
                    if (lease.error) throw lease.error;
                    if (!outcome?.completed) await completeStage(database, claimedStage);
                } catch (error) {
                    await lease.stop();
                    await scheduleRetry(database, claimedStage, clock.now(), maxAttempts, retryBaseDelayMs, retryMaxDelayMs, error instanceof Error ? error.message : "Processing failed unexpectedly");
                }
                return 1;
            } finally {
                running = false;
            }
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
            INNER JOIN processing_attempts AS attempt ON attempt.id = stage.processing_attempt_id
            INNER JOIN knowledge_items AS item ON item.id = attempt.knowledge_item_id
            WHERE stage.kind IN (${sql.join(handledKinds.map(kind => sql`${kind}`), sql`, `)})
              AND item.lifecycle_state = 'active'
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

function startLeaseRenewal(
    database: Database,
    stage: ClaimedStageRow,
    clock: Clock,
    leaseDurationMs: number,
    intervalMs: number,
): { stop(): Promise<void>; readonly error: Error | undefined } {
    let stopped = false;
    let renewalError: Error | undefined;
    let renewal = Promise.resolve();
    const interval = setInterval(() => {
        if (stopped || renewalError) return;
        renewal = renewal.then(async () => {
            const result = await database.execute(sql`
                UPDATE processing_stages
                SET lease_expires_at = ${new Date(clock.now().getTime() + leaseDurationMs)}
                WHERE id = ${stage.id}
                  AND status = 'running'
                  AND lease_token = ${stage.leaseToken}
                RETURNING id
            `);
            if (result.rows.length === 0) throw new Error(`Processing stage ${stage.id} lost its lease while running`);
        }).catch(error => {
            renewalError = error instanceof Error ? error : new Error("Processing stage lease renewal failed");
        });
    }, intervalMs);
    return {
        async stop() {
            if (!stopped) {
                stopped = true;
                clearInterval(interval);
            }
            await renewal;
        },
        get error() { return renewalError; },
    };
}

async function scheduleRetry(
    database: Database,
    stage: ClaimedStageRow,
    now: Date,
    maxAttempts: number,
    retryBaseDelayMs: number,
    retryMaxDelayMs: number,
    failureReason: string,
): Promise<void> {
    const exhausted = stage.attemptCount >= maxAttempts;
    const delayMs = Math.min(retryBaseDelayMs * 2 ** (stage.attemptCount - 1), retryMaxDelayMs);
    const result = await database.execute(sql`
        UPDATE processing_stages
        SET status = ${exhausted ? "failed" : "pending"},
            available_at = ${new Date(now.getTime() + delayMs)},
            lease_token = NULL,
            lease_expires_at = NULL,
            failure_reason = ${exhausted ? failureReason : null}
        WHERE id = ${stage.id}
          AND status = 'running'
          AND lease_token = ${stage.leaseToken}
        RETURNING id
    `);
    if (exhausted && (isRequiredRetrievalStage(stage.kind) || stage.kind === "topic-tag-generation") && result.rows.length > 0) {
        await database.update(schema.processingAttempts).set({ status: "failed", failureReason })
            .where(sql`${schema.processingAttempts.id} = ${stage.processingAttemptId}`);
    }
}

if (import.meta.main) {
    const providers = createOllamaProviders();
    await providers.preflight();
    startProcessingWorker(createArticleProcessingWorker({
        database: db,
        embeddingProvider: providers.embeddingProvider,
        summaryProvider: providers.summaryProvider,
        topicTagProvider: providers.topicTagProvider,
    }));
    try {
        startProcessingWorker(createOriginalFileOperationsWorker({ database: db, storage: cloudinaryOriginalFileStorageFromEnvironment(process.env) }));
    } catch (error) {
        if (!(error instanceof OriginalFileStorageError) || error.kind !== "configuration") throw error;
        console.warn("Original File reconciliation is disabled until Cloudinary is configured.");
    }
}

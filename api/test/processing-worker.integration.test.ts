import { eq } from "drizzle-orm";
import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { processingStages } from "../src/db/schema";
import { DeterministicEmbeddingProvider, ManualClock } from "./support/deterministic-runtime";
import { processingStageKinds } from "../src/lib/processing/stages";
import { createLexicalIndexingStageHandler } from "../src/lib/passages/index-lexical-passages";
import { createPassageGenerationStageHandler } from "../src/lib/passages/generate-passages";
import { createSemanticIndexingStageHandler } from "../src/lib/passages/index-semantic-passages";
import { createSnapshotPersistenceStageHandler } from "../src/lib/sources/persist-cleaned-source-snapshot";
import { createExtractionStageHandler } from "../src/lib/sources/extract-public-textual-source";
import { createProcessingWorker } from "../src/worker";
import { createIntegrationHarness, type IntegrationHarness } from "./support/integration-harness";

let harness: IntegrationHarness | undefined;

afterEach(async () => {
    await harness?.cleanup();
    harness = undefined;
});

function startHarness(handler: (kind: string) => Promise<void>, options: {
    maxAttempts?: number;
    retryBaseDelayMs?: number;
    retryMaxDelayMs?: number;
    leaseDurationMs?: number;
} = {}) {
    const clock = new ManualClock(new Date("2099-01-01T12:00:00.000Z"));
    return createIntegrationHarness(database => createApp({ database: database.db }), database => createProcessingWorker({
        database: database.db,
        workerId: "test-worker",
        clock,
        ...options,
        handlers: {
            extraction: () => handler("extraction"),
            "snapshot-persistence": () => handler("snapshot-persistence"),
            "passage-generation": () => handler("passage-generation"),
            "lexical-indexing": () => handler("lexical-indexing"),
            "semantic-indexing": () => handler("semantic-indexing"),
            "recognition-summary-generation": () => handler("recognition-summary-generation"),
            "topic-tag-generation": () => handler("topic-tag-generation"),
        },
    }));
}

describe("Processing worker", () => {
    test.skipIf(!process.env.TEST_DATABASE_URL)("waits until a stage becomes available before claiming it", async () => {
        const clock = new ManualClock(new Date("2099-01-01T12:00:00.000Z"));
        harness = await startHarness(async () => {});
        const response = await fetch(`${harness.apiBaseUrl}/captures`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: "https://example.com/article" }),
        });
        const capture = await response.json() as { processingAttemptId: number };
        const [stage] = await harness.database.db.select().from(processingStages)
            .where(eq(processingStages.processingAttemptId, capture.processingAttemptId))
            .orderBy(processingStages.id)
            .limit(1);
        const worker = createProcessingWorker({
            database: harness.database.db,
            workerId: "test-worker",
            clock,
            handlers: { extraction: async () => {} },
        });
        await harness.database.db.update(processingStages).set({ availableAt: new Date(clock.now().getTime() + 60_000) })
            .where(eq(processingStages.id, stage!.id));

        expect(await worker.runEligibleWork()).toBe(0);
        clock.advance(60_000);
        expect(await worker.runEligibleWork()).toBe(1);

        const [completedStage] = await harness.database.db.select().from(processingStages)
            .where(eq(processingStages.id, stage!.id));
        expect(completedStage).toEqual(expect.objectContaining({ status: "completed", attemptCount: 1 }));
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("executes stages only after their prerequisites complete and releases independent work", async () => {
        const completed: string[] = [];
        harness = await startHarness(async kind => { completed.push(kind); });

        const response = await fetch(`${harness.apiBaseUrl}/captures`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: "https://example.com/article" }),
        });
        expect(response.status).toBe(201);

        await harness.drainWorker();

        expect(completed).toEqual([
            "extraction",
            "snapshot-persistence",
            "passage-generation",
            "lexical-indexing",
            "semantic-indexing",
            "recognition-summary-generation",
            "topic-tag-generation",
        ]);
        const stages = await harness.database.db.select().from(processingStages).orderBy(processingStages.id);
        expect(stages.every(stage => stage.status === "completed")).toBe(true);
        expect(stages.every(stage => stage.leaseToken === null && stage.leaseExpiresAt === null)).toBe(true);
        expect(stages.every(stage => stage.attemptCount === 1)).toBe(true);
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("does not let a stale worker completion overwrite a newer lease", async () => {
        let releaseHandler: (() => void) | undefined;
        const handlerStarted = Promise.withResolvers<void>();
        const handlerRelease = new Promise<void>(resolve => { releaseHandler = resolve; });
        const clock = new ManualClock(new Date("2099-01-01T12:00:00.000Z"));
        harness = await createIntegrationHarness(database => createApp({ database: database.db }), database => createProcessingWorker({
            database: database.db,
            workerId: "first-worker",
            clock,
            leaseDurationMs: 1_000,
            handlers: { extraction: async () => { handlerStarted.resolve(); await handlerRelease; } },
        }));

        const response = await fetch(`${harness.apiBaseUrl}/captures`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: "https://example.com/article" }),
        });
        const capture = await response.json() as { processingAttemptId: number };
        const run = createProcessingWorker({
            database: harness.database.db,
            workerId: "first-worker",
            clock,
            leaseDurationMs: 1_000,
            handlers: { extraction: async () => { handlerStarted.resolve(); await handlerRelease; } },
        }).runEligibleWork();
        await handlerStarted.promise;

        const [claimedStage] = await harness.database.db.select().from(processingStages)
            .where(eq(processingStages.processingAttemptId, capture.processingAttemptId))
            .orderBy(processingStages.id)
            .limit(1);
        expect(claimedStage?.status).toBe("running");
        clock.advance(1_000);
        const newerWorker = createProcessingWorker({
            database: harness.database.db,
            workerId: "newer-worker",
            clock,
            leaseDurationMs: 1_000,
            handlers: { extraction: async () => {} },
        });
        expect(await newerWorker.runEligibleWork()).toBe(1);

        releaseHandler!();
        await run;

        const [stage] = await harness.database.db.select().from(processingStages)
            .where(eq(processingStages.id, claimedStage!.id));
        expect(stage).toEqual(expect.objectContaining({ status: "completed", attemptCount: 2 }));
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("retries transient failures with bounded backoff before exhausting the stage", async () => {
        const clock = new ManualClock(new Date("2099-01-01T12:00:00.000Z"));
        let runs = 0;
        harness = await createIntegrationHarness(database => createApp({ database: database.db }), database => createProcessingWorker({
            database: database.db,
            workerId: "retry-worker",
            clock,
            maxAttempts: 3,
            retryBaseDelayMs: 1_000,
            retryMaxDelayMs: 2_000,
            handlers: { extraction: async () => { runs += 1; throw new Error("temporary failure"); } },
        }));
        const response = await fetch(`${harness.apiBaseUrl}/captures`, {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://example.com/article" }),
        });
        const capture = await response.json() as { processingAttemptId: number };

        expect(await harness.drainWorker()).toBeUndefined();
        expect(runs).toBe(1);
        clock.advance(1_000);
        await harness.drainWorker();
        clock.advance(2_000);
        await harness.drainWorker();
        expect(runs).toBe(3);

        const [stage] = await harness.database.db.select().from(processingStages)
            .where(eq(processingStages.processingAttemptId, capture.processingAttemptId)).orderBy(processingStages.id).limit(1);
        expect(stage).toEqual(expect.objectContaining({ status: "failed", attemptCount: 3, leaseToken: null, leaseExpiresAt: null }));
        expect(await harness.drainWorker()).toBeUndefined();
        expect(runs).toBe(3);
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("resumes only the incomplete stage after a partial workflow failure", async () => {
        const clock = new ManualClock(new Date("2099-01-01T12:00:00.000Z"));
        const runs: Record<string, number> = {};
        harness = await createIntegrationHarness(database => createApp({ database: database.db }), database => createProcessingWorker({
            database: database.db,
            workerId: "retry-worker",
            clock,
            retryBaseDelayMs: 1_000,
            handlers: Object.fromEntries(processingStageKinds.map(kind => [kind, async () => {
                runs[kind] = (runs[kind] ?? 0) + 1;
                if (kind === "lexical-indexing" && runs[kind] === 1) throw new Error("temporary failure");
            }])),
        }));
        const response = await fetch(`${harness.apiBaseUrl}/captures`, {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://example.com/article" }),
        });
        expect(response.status).toBe(201);

        await harness.drainWorker();
        expect(runs["lexical-indexing"]).toBe(1);
        expect(runs["semantic-indexing"]).toBe(1);
        clock.advance(1_000);
        await harness.drainWorker();
        expect(runs["lexical-indexing"]).toBe(2);
        expect(runs["semantic-indexing"]).toBe(1);
        expect(runs["passage-generation"]).toBe(1);
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("manually retries only failed retrieval work without recreating the Knowledge Item", async () => {
        const runs: Record<string, number> = {};
        const embeddingProvider = new DeterministicEmbeddingProvider();
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider }),
            (database, sourceServer) => {
                const extraction = createExtractionStageHandler(database.db, sourceServer.safeFetchDependencies());
                const snapshotPersistence = createSnapshotPersistenceStageHandler(database.db);
                const passageGeneration = createPassageGenerationStageHandler(database.db);
                const lexicalIndexing = createLexicalIndexingStageHandler(database.db);
                const semanticIndexing = createSemanticIndexingStageHandler(database.db, embeddingProvider);
                return createProcessingWorker({
                    database: database.db,
                    workerId: "manual-retry-worker",
                    maxAttempts: 1,
                    handlers: {
                        extraction: async stage => { runs.extraction = (runs.extraction ?? 0) + 1; await extraction(stage); },
                        "snapshot-persistence": async stage => { runs["snapshot-persistence"] = (runs["snapshot-persistence"] ?? 0) + 1; await snapshotPersistence(stage); },
                        "passage-generation": async stage => { runs["passage-generation"] = (runs["passage-generation"] ?? 0) + 1; await passageGeneration(stage); },
                        "lexical-indexing": async stage => {
                            runs["lexical-indexing"] = (runs["lexical-indexing"] ?? 0) + 1;
                            if (runs["lexical-indexing"] === 1) throw new Error("lexical index is unavailable");
                            await lexicalIndexing(stage);
                        },
                        "semantic-indexing": async stage => { runs["semantic-indexing"] = (runs["semantic-indexing"] ?? 0) + 1; await semanticIndexing(stage); },
                        "recognition-summary-generation": async () => { runs["recognition-summary-generation"] = (runs["recognition-summary-generation"] ?? 0) + 1; },
                        "topic-tag-generation": async () => { runs["topic-tag-generation"] = (runs["topic-tag-generation"] ?? 0) + 1; },
                    },
                });
            },
        );

        const captureResponse = await fetch(`${harness.apiBaseUrl}/captures`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: harness.sourceServer.fetchUrl("/articles/primary-text") }),
        });
        const capture = await captureResponse.json() as { knowledgeItemId: number; processingAttemptId: number };
        await harness.drainWorker();

        const failedItem = await (await fetch(`${harness.apiBaseUrl}/knowledge-items/${capture.knowledgeItemId}`)).json() as {
            availability: string;
            latestAttempt: { status: string; failureReason?: string };
        };
        expect(failedItem).toEqual(expect.objectContaining({
            availability: "needs-attention",
            latestAttempt: expect.objectContaining({ status: "failed", failureReason: "lexical index is unavailable" }),
        }));

        const retryResponse = await fetch(`${harness.apiBaseUrl}/knowledge-items/${capture.knowledgeItemId}/retry`, {
            method: "POST",
        });
        expect(retryResponse.status).toBe(202);
        expect(await retryResponse.json()).toEqual(expect.objectContaining({
            processingAttemptId: expect.any(Number),
            knowledgeItem: expect.objectContaining({
                availability: "processing",
                latestAttempt: expect.objectContaining({ kind: "manual-retry", status: "pending" }),
            }),
        }));

        await harness.drainWorker();

        const recoveredItem = await (await fetch(`${harness.apiBaseUrl}/knowledge-items/${capture.knowledgeItemId}`)).json() as {
            availability: string;
            latestAttempt: { kind: string; status: string };
        };
        expect(recoveredItem).toEqual(expect.objectContaining({
            availability: "ready",
            latestAttempt: expect.objectContaining({ kind: "manual-retry", status: "completed" }),
        }));
        expect(runs).toEqual({
            extraction: 1,
            "snapshot-persistence": 1,
            "passage-generation": 1,
            "lexical-indexing": 2,
            "semantic-indexing": 1,
            "recognition-summary-generation": 1,
            "topic-tag-generation": 1,
        });
        const history = await harness.database.pool.query<{
            kind: string;
            status: string;
            attempt_count: number;
        }>(`
            SELECT attempt.kind, stage.status, stage.attempt_count
            FROM processing_attempts AS attempt
            INNER JOIN processing_stages AS stage ON stage.processing_attempt_id = attempt.id
            WHERE attempt.knowledge_item_id = $1
            ORDER BY attempt.id, stage.id
        `, [capture.knowledgeItemId]);
        expect(history.rows).toEqual([
            { kind: "initial-capture", status: "completed", attempt_count: 1 },
            { kind: "initial-capture", status: "completed", attempt_count: 1 },
            { kind: "initial-capture", status: "completed", attempt_count: 1 },
            { kind: "initial-capture", status: "failed", attempt_count: 1 },
            { kind: "initial-capture", status: "completed", attempt_count: 1 },
            { kind: "initial-capture", status: "completed", attempt_count: 1 },
            { kind: "initial-capture", status: "completed", attempt_count: 1 },
            { kind: "manual-retry", status: "completed", attempt_count: 0 },
            { kind: "manual-retry", status: "completed", attempt_count: 0 },
            { kind: "manual-retry", status: "completed", attempt_count: 0 },
            { kind: "manual-retry", status: "completed", attempt_count: 1 },
            { kind: "manual-retry", status: "completed", attempt_count: 0 },
            { kind: "manual-retry", status: "completed", attempt_count: 0 },
            { kind: "manual-retry", status: "completed", attempt_count: 0 },
        ]);
    });
});

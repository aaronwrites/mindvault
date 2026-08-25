import { eq } from "drizzle-orm";
import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { processingStages } from "../src/db/schema";
import { processingStageKinds } from "../src/lib/processing/stages";
import { createProcessingWorker } from "../src/worker";
import { ManualClock } from "./support/deterministic-runtime";
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
});

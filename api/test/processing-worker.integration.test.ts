import { eq } from "drizzle-orm";
import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { processingStages } from "../src/db/schema";
import { createProcessingWorker } from "../src/worker";
import { ManualClock } from "./support/deterministic-runtime";
import { createIntegrationHarness, type IntegrationHarness } from "./support/integration-harness";

let harness: IntegrationHarness | undefined;

afterEach(async () => {
    await harness?.cleanup();
    harness = undefined;
});

function startHarness(handler: (kind: string) => Promise<void>) {
    const clock = new ManualClock(new Date("2026-08-24T12:00:00.000Z"));
    return createIntegrationHarness(database => createApp({ database: database.db }), database => createProcessingWorker({
        database: database.db,
        workerId: "test-worker",
        clock,
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
        const clock = new ManualClock(new Date("2026-08-24T12:00:00.000Z"));
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
        harness = await startHarness(async () => {
            handlerStarted.resolve();
            await handlerRelease;
        });

        const response = await fetch(`${harness.apiBaseUrl}/captures`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: "https://example.com/article" }),
        });
        const capture = await response.json() as { processingAttemptId: number };
        const run = createProcessingWorker({
            database: harness.database.db,
            workerId: "test-worker",
            handlers: { extraction: async () => { handlerStarted.resolve(); await handlerRelease; } },
        }).runEligibleWork();
        await handlerStarted.promise;

        const [claimedStage] = await harness.database.db.select().from(processingStages)
            .where(eq(processingStages.processingAttemptId, capture.processingAttemptId))
            .orderBy(processingStages.id)
            .limit(1);
        expect(claimedStage?.status).toBe("running");
        await harness.database.db.update(processingStages).set({ leaseToken: "newer-worker" })
            .where(eq(processingStages.id, claimedStage!.id));

        releaseHandler!();
        await run;

        const [stage] = await harness.database.db.select().from(processingStages)
            .where(eq(processingStages.id, claimedStage!.id));
        expect(stage).toEqual(expect.objectContaining({ status: "running", leaseToken: "newer-worker" }));
    });
});

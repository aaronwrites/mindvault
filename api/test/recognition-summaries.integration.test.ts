import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import type { TextGenerationProvider } from "../src/lib/ai/providers";
import { createExtractionStageHandler } from "../src/lib/sources/extract-public-textual-source";
import { createSnapshotPersistenceStageHandler } from "../src/lib/sources/persist-cleaned-source-snapshot";
import { createArticleProcessingWorker, createProcessingWorker } from "../src/worker";
import { DeterministicEmbeddingProvider } from "./support/deterministic-runtime";
import { createIntegrationHarness, type IntegrationHarness } from "./support/integration-harness";

let harness: IntegrationHarness | undefined;

afterEach(async () => {
    await harness?.cleanup();
    harness = undefined;
});

class RecordingSummaryProvider implements TextGenerationProvider {
    prompts: string[] = [];

    async generate(prompt: string): Promise<string> {
        this.prompts.push(prompt);
        return "A generated description of durable Capture and visible Processing Attempts.";
    }
}

class FailingSummaryProvider implements TextGenerationProvider {
    async generate(): Promise<string> {
        throw new Error("summary provider unavailable");
    }
}

describe("Recognition Summaries", () => {
    test.skipIf(!process.env.TEST_DATABASE_URL)("generates a current summary from Source Snapshot content and Capture Context that list, detail, and Recall return", async () => {
        const embeddings = new DeterministicEmbeddingProvider();
        const summaries = new RecordingSummaryProvider();
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: embeddings }),
            (database, sourceServer) => createArticleProcessingWorker({
                database: database.db,
                sourceFetchOptions: sourceServer.safeFetchDependencies(),
                embeddingProvider: embeddings,
                summaryProvider: summaries,
            }),
        );

        const captureResponse = await fetch(`${harness.apiBaseUrl}/captures`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                url: harness.sourceServer.fetchUrl("/articles/primary-text"),
                selectedText: "Extraction keeps meaningful primary text.",
                personalNote: "Remember why Processing Attempts matter.",
            }),
        });
        expect(captureResponse.status).toBe(201);
        const capture = await captureResponse.json() as { knowledgeItemId: number };

        await harness.drainWorker();

        expect(summaries.prompts).toEqual([
            expect.stringContaining("Durable Capture stores a Source before asynchronous processing begins."),
        ]);
        expect(summaries.prompts[0]).toContain("Selected source text: Extraction keeps meaningful primary text.");
        expect(summaries.prompts[0]).toContain("Personal note: Remember why Processing Attempts matter.");

        const expectedSummary = "A generated description of durable Capture and visible Processing Attempts.";
        const listResponse = await fetch(`${harness.apiBaseUrl}/knowledge-items`);
        expect(await listResponse.json()).toEqual([
            expect.objectContaining({ id: capture.knowledgeItemId, recognitionSummary: expectedSummary }),
        ]);
        const detailResponse = await fetch(`${harness.apiBaseUrl}/knowledge-items/${capture.knowledgeItemId}`);
        expect(await detailResponse.json()).toEqual(expect.objectContaining({ recognitionSummary: expectedSummary }));
        const searchResponse = await fetch(`${harness.apiBaseUrl}/search?q=${encodeURIComponent("Durable Capture")}`);
        expect(await searchResponse.json()).toEqual([
            expect.objectContaining({ id: capture.knowledgeItemId, recognitionSummary: expectedSummary }),
        ]);
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("keeps retrieval Ready when Recognition Summary generation exhausts its independent retry stage", async () => {
        const embeddings = new DeterministicEmbeddingProvider();
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: embeddings }),
            (database, sourceServer) => createArticleProcessingWorker({
                database: database.db,
                sourceFetchOptions: sourceServer.safeFetchDependencies(),
                embeddingProvider: embeddings,
                summaryProvider: new FailingSummaryProvider(),
                maxAttempts: 1,
            }),
        );

        const captureResponse = await fetch(`${harness.apiBaseUrl}/captures`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: harness.sourceServer.fetchUrl("/articles/primary-text") }),
        });
        const capture = await captureResponse.json() as { knowledgeItemId: number; processingAttemptId: number };
        await harness.drainWorker();

        const detailResponse = await fetch(`${harness.apiBaseUrl}/knowledge-items/${capture.knowledgeItemId}`);
        expect(await detailResponse.json()).toEqual(expect.objectContaining({
            availability: "ready",
            recognitionSummary: null,
            latestAttempt: expect.objectContaining({ status: "completed" }),
        }));
        const history = await harness.database.pool.query<{ status: string; attempt_count: number; failure_reason: string | null }>(`
            SELECT status, attempt_count, failure_reason
            FROM processing_stages
            WHERE processing_attempt_id = $1 AND kind = 'recognition-summary-generation'
        `, [capture.processingAttemptId]);
        expect(history.rows).toEqual([{
            status: "failed",
            attempt_count: 1,
            failure_reason: "summary provider unavailable",
        }]);
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("does not present a previous Source Snapshot's summary while a Refresh summary is incomplete", async () => {
        const embeddings = new DeterministicEmbeddingProvider();
        const summaries = new RecordingSummaryProvider();
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: embeddings }),
            (database, sourceServer) => createArticleProcessingWorker({
                database: database.db,
                sourceFetchOptions: sourceServer.safeFetchDependencies(),
                embeddingProvider: embeddings,
                summaryProvider: summaries,
            }),
        );
        const captureResponse = await fetch(`${harness.apiBaseUrl}/captures`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: harness.sourceServer.fetchUrl("/articles/changed") }),
        });
        const capture = await captureResponse.json() as { knowledgeItemId: number };
        await harness.drainWorker();

        harness.sourceServer.setChangedArticleVersion(2);
        const refreshResponse = await fetch(`${harness.apiBaseUrl}/knowledge-items/${capture.knowledgeItemId}/refresh`, { method: "POST" });
        expect(refreshResponse.status).toBe(202);
        const extraction = createExtractionStageHandler(harness.database.db, harness.sourceServer.safeFetchDependencies());
        const snapshots = createSnapshotPersistenceStageHandler(harness.database.db);
        await (async () => {
            const worker = createProcessingWorker({
                database: harness!.database.db,
                handlers: { extraction, "snapshot-persistence": snapshots },
            });
            while (await worker.runEligibleWork()) {
                // Complete only the refresh stages needed to make the new Source Snapshot current.
            }
        })();

        const detailResponse = await fetch(`${harness.apiBaseUrl}/knowledge-items/${capture.knowledgeItemId}`);
        expect(await detailResponse.json()).toEqual(expect.objectContaining({ recognitionSummary: null }));
    });
});

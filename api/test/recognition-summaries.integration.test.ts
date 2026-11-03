import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import type { SummaryGrounding, TextGenerationProvider } from "../src/lib/ai/providers";
import { createExtractionStageHandler } from "../src/lib/sources/extract-public-textual-source";
import { createSnapshotPersistenceStageHandler } from "../src/lib/sources/persist-cleaned-source-snapshot";
import { createArticleProcessingWorker, createProcessingWorker } from "../src/worker";
import { DeterministicEmbeddingProvider, DeterministicTopicTagGenerationProvider } from "./support/deterministic-runtime";
import { createIntegrationHarness, type IntegrationHarness } from "./support/integration-harness";

let harness: IntegrationHarness | undefined;

afterEach(async () => {
    await harness?.cleanup();
    harness = undefined;
});

class RecordingSummaryProvider implements TextGenerationProvider {
    prompts: string[] = [];
    groundingInputs: Array<SummaryGrounding | undefined> = [];

    async generate(prompt: string, grounding?: SummaryGrounding): Promise<string> {
        this.prompts.push(prompt);
        this.groundingInputs.push(grounding);
        return "A generated description of durable Capture and visible Processing Attempts.";
    }
}

class FailingSummaryProvider implements TextGenerationProvider {
    async generate(): Promise<string> {
        throw new Error("summary provider unavailable");
    }
}

describe("Recognition Summaries", () => {
    test.skipIf(!process.env.TEST_DATABASE_URL)("bounds an oversized generated summary without shortening retained Source evidence", async () => {
        const embeddings = new DeterministicEmbeddingProvider();
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: embeddings }),
            (database, sourceServer) => createArticleProcessingWorker({
                database: database.db, sourceFetchOptions: sourceServer.safeFetchDependencies(), embeddingProvider: embeddings,
                summaryProvider: { generate: async () => "Durable Capture preserves knowledge. " + "More detail about processing and retrieval. ".repeat(250) },
                topicTagProvider: new DeterministicTopicTagGenerationProvider(),
            }),
        );
        const capture = await fetch(`${harness.apiBaseUrl}/captures`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: harness.sourceServer.fetchUrl("/articles/primary-text") }),
        }).then(response => response.json()) as { knowledgeItemId: number };
        await harness.drainWorker();
        const item = await fetch(`${harness.apiBaseUrl}/knowledge-items/${capture.knowledgeItemId}`).then(response => response.json()) as { recognitionSummary: string };
        expect(item.recognitionSummary.length).toBeLessThanOrEqual(320);
        expect(item.recognitionSummary).toStartWith("Durable Capture preserves knowledge.");
        const matches = await fetch(`${harness.apiBaseUrl}/search?q=${encodeURIComponent("Processing Attempts")}`).then(response => response.json()) as Array<{ recognitionSummary: string; excerpts: Array<{ text: string }> }>;
        expect(matches[0]?.recognitionSummary).toBe(item.recognitionSummary);
        expect(matches[0]?.excerpts.some(excerpt => excerpt.text.includes("A cleaned representation preserves the useful material"))).toBe(true);
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("keeps a Ready attempt active until summary and Topic Tags are visible", async () => {
        const embeddings = new DeterministicEmbeddingProvider();
        let summaryStarted!: () => void;
        let releaseSummary!: (text: string) => void;
        const summaryEntered = new Promise<void>(resolve => { summaryStarted = resolve; });
        const summaryOutput = new Promise<string>(resolve => { releaseSummary = resolve; });
        let tagsStarted!: () => void;
        let releaseTags!: () => void;
        const tagsEntered = new Promise<void>(resolve => { tagsStarted = resolve; });
        const tagsOutput = new Promise<void>(resolve => { releaseTags = resolve; });
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: embeddings }),
            (database, sourceServer) => createArticleProcessingWorker({
                database: database.db, sourceFetchOptions: sourceServer.safeFetchDependencies(), embeddingProvider: embeddings,
                summaryProvider: { generate: async () => { summaryStarted(); return summaryOutput; } },
                topicTagProvider: { generateTopicTags: async () => { tagsStarted(); await tagsOutput; return [{ name: "Durable Capture", aliases: [] }]; } },
            }),
        );
        const captured = await fetch(`${harness.apiBaseUrl}/captures`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: harness.sourceServer.fetchUrl("/articles/primary-text") }),
        }).then(response => response.json()) as { knowledgeItemId: number };
        const processing = harness.drainWorker();
        try {
            await summaryEntered;
            const readItem = () => fetch(`${harness!.apiBaseUrl}/knowledge-items/${captured.knowledgeItemId}`).then(response => response.json()) as Promise<{ availability: string; latestAttempt: { status: string }; recognitionSummary: string | null; topicTags: string[] }>;
            const awaitingSummary = await readItem();
            expect(awaitingSummary.availability).toBe("ready");
            expect(awaitingSummary.latestAttempt.status).not.toBe("completed");
            releaseSummary("A concise recognition summary.");
            await tagsEntered;
            const awaitingTags = await readItem();
            expect(awaitingTags.recognitionSummary).toBe("A concise recognition summary.");
            expect(awaitingTags.topicTags).toEqual([]);
            expect(awaitingTags.latestAttempt.status).not.toBe("completed");
            releaseTags();
            await processing;
            expect(await readItem()).toEqual(expect.objectContaining({ latestAttempt: expect.objectContaining({ status: "completed" }), topicTags: ["Durable Capture"] }));
        } finally {
            releaseSummary("A concise recognition summary.");
            releaseTags();
            await processing;
        }
    });

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
                topicTagProvider: new DeterministicTopicTagGenerationProvider(),
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

        expect(summaries.groundingInputs[0]?.sourceText).toContain("Durable Capture stores a Source before asynchronous processing begins.");
        expect(summaries.groundingInputs[0]?.sourceText).not.toContain("Remember why Processing Attempts matter.");
        const expectedSummary = "A generated description of durable Capture and visible Processing Attempts.";
        const listResponse = await fetch(`${harness.apiBaseUrl}/knowledge-items`);
        expect(await listResponse.json()).toEqual([
            expect.objectContaining({ id: capture.knowledgeItemId, recognitionSummary: expectedSummary }),
        ]);
        const detailResponse = await fetch(`${harness.apiBaseUrl}/knowledge-items/${capture.knowledgeItemId}`);
        expect(await detailResponse.json()).toEqual(expect.objectContaining({ recognitionSummary: expectedSummary, recognitionSummaryProvenance: expect.objectContaining({ contract: "tldr-v1", evidenceCoverage: "primary-content", isCurrent: true }) }));
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
                topicTagProvider: new DeterministicTopicTagGenerationProvider(),
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
            recognitionSummaryProvenance: null,
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

    test.skipIf(!process.env.TEST_DATABASE_URL)("keeps a previous Recognition Summary visible while a Refresh summary is incomplete", async () => {
        const embeddings = new DeterministicEmbeddingProvider();
        const summaries = new RecordingSummaryProvider();
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: embeddings }),
            (database, sourceServer) => createArticleProcessingWorker({
                database: database.db,
                sourceFetchOptions: sourceServer.safeFetchDependencies(),
                embeddingProvider: embeddings,
                summaryProvider: summaries,
                topicTagProvider: new DeterministicTopicTagGenerationProvider(),
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
                // Complete only the Refresh stages before trustworthy representation activation.
            }
        })();

        const detailResponse = await fetch(`${harness.apiBaseUrl}/knowledge-items/${capture.knowledgeItemId}`);
        expect(await detailResponse.json()).toEqual(expect.objectContaining({
            recognitionSummary: "A generated description of durable Capture and visible Processing Attempts.",
        }));
    });
});

test.skipIf(!process.env.TEST_DATABASE_URL)("legacy descriptions remain Preview until regeneration, which preserves title, tag corrections and Personal Notes", async () => {
    const embeddings = new DeterministicEmbeddingProvider();
    harness = await createIntegrationHarness(
        database => createApp({ database: database.db, embeddingProvider: embeddings }),
        (database, server) => createArticleProcessingWorker({ database: database.db, sourceFetchOptions: server.safeFetchDependencies(),
            embeddingProvider: embeddings, summaryProvider: new RecordingSummaryProvider(), topicTagProvider: new DeterministicTopicTagGenerationProvider() }),
    );
    const request = (path: string, method = "GET", body?: unknown) => fetch(`${harness!.apiBaseUrl}${path}`, {
        method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    const captured = await (await request("/captures", "POST", { url: harness.sourceServer.fetchUrl("/articles/primary-text"), personalNote: "My own interpretation." })).json() as { knowledgeItemId: number };
    await harness.drainWorker();
    const path = `/knowledge-items/${captured.knowledgeItemId}`;
    // Simulate a pre-adoption stored description, never backfilled as TL;DR.
    await harness.database.pool.query("UPDATE recognition_summaries SET generation_contract = NULL WHERE knowledge_item_id = $1", [captured.knowledgeItemId]);
    expect(await (await request(path)).json()).toMatchObject({ recognitionSummaryProvenance: { contract: null, isCurrent: true } });
    expect((await request(`${path}/title`, "PATCH", { customTitle: "My recovery reference" })).status).toBe(200);
    expect((await request(`${path}/tags`, "PATCH", { add: ["My topic"], remove: ["Testing"] })).status).toBe(200);
    const before = await (await request(path)).json() as { captureContexts: Array<{ id: number }> };
    expect((await request(`${path}/notes/${before.captureContexts[0]!.id}`, "PATCH", { text: "My corrected interpretation." })).status).toBe(200);
    expect((await request(`${path}/refresh`, "POST")).status).toBe(202);
    await harness.drainWorker();
    expect(await (await request(path)).json()).toMatchObject({
        title: "My recovery reference", customTitle: "My recovery reference", topicTags: ["My topic"],
        captureContexts: [expect.objectContaining({ text: "My corrected interpretation." })],
        recognitionSummaryProvenance: { contract: "tldr-v1", isCurrent: true, evidenceCoverage: "primary-content" },
    });
}, 20_000);

test.skipIf(!process.env.TEST_DATABASE_URL)("metadata generation stays a Preview and receives no primary-content grounding", async () => {
    const embeddings = new DeterministicEmbeddingProvider();
    const groundingInputs: unknown[] = [];
    harness = await createIntegrationHarness(
        database => createApp({ database: database.db, embeddingProvider: embeddings }),
        (database, server) => createArticleProcessingWorker({ database: database.db, sourceFetchOptions: server.safeFetchDependencies(), embeddingProvider: embeddings,
            summaryProvider: { async generate(_prompt, grounding) { groundingInputs.push(grounding); return "A page about event-driven projections."; } },
            topicTagProvider: new DeterministicTopicTagGenerationProvider() }),
    );
    const captured = await fetch(`${harness.apiBaseUrl}/captures`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: harness.sourceServer.fetchUrl("/metadata/description-only") }) }).then(response => response.json()) as { knowledgeItemId: number };
    await harness.drainWorker();
    expect(groundingInputs).toEqual([undefined]);
    expect(await fetch(`${harness.apiBaseUrl}/knowledge-items/${captured.knowledgeItemId}`).then(response => response.json())).toMatchObject({
        availability: "ready", evidenceCoverage: "metadata-only",
        recognitionSummaryProvenance: { contract: "preview-v1", evidenceCoverage: "metadata-only", isCurrent: true },
    });
}, 20_000);

test.skipIf(!process.env.TEST_DATABASE_URL)("a failed new-version summary retains earlier provenance without presenting it as a current TL;DR", async () => {
    const embeddings = new DeterministicEmbeddingProvider();
    let fail = false;
    harness = await createIntegrationHarness(
        database => createApp({ database: database.db, embeddingProvider: embeddings }),
        (database, server) => createArticleProcessingWorker({ database: database.db, sourceFetchOptions: server.safeFetchDependencies(), embeddingProvider: embeddings,
            summaryProvider: { async generate() { if (fail) throw new Error("summary unavailable"); return "The original content preserves knowledge."; } },
            topicTagProvider: new DeterministicTopicTagGenerationProvider(), maxAttempts: 1 }),
    );
    const captured = await fetch(`${harness.apiBaseUrl}/captures`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: harness.sourceServer.fetchUrl("/articles/changed") }) }).then(response => response.json()) as { knowledgeItemId: number };
    await harness.drainWorker();
    const path = `${harness.apiBaseUrl}/knowledge-items/${captured.knowledgeItemId}`;
    const before = await fetch(path).then(response => response.json()) as { recognitionSummaryProvenance: { sourceSnapshotId: number } };
    harness.sourceServer.setChangedArticleVersion(2);
    fail = true;
    expect((await fetch(`${path}/refresh`, { method: "POST" })).status).toBe(202);
    await harness.drainWorker();
    expect(await fetch(path).then(response => response.json())).toMatchObject({
        availability: "ready", recognitionSummary: "The original content preserves knowledge.",
        recognitionSummaryProvenance: { contract: "tldr-v1", sourceSnapshotId: before.recognitionSummaryProvenance.sourceSnapshotId, isCurrent: false },
        latestAttempt: { status: "completed", warnings: ["summary unavailable"] },
    });
}, 20_000);

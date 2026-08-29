import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import type { GeneratedTopicTag, TextGenerationProvider, TopicTagGenerationProvider } from "../src/lib/ai/providers";
import { createArticleProcessingWorker } from "../src/worker";
import { DeterministicEmbeddingProvider } from "./support/deterministic-runtime";
import { createIntegrationHarness, type IntegrationHarness } from "./support/integration-harness";

let harness: IntegrationHarness | undefined;

afterEach(async () => {
    await harness?.cleanup();
    harness = undefined;
});

class StaticSummaryProvider implements TextGenerationProvider {
    async generate(): Promise<string> {
        return "A generated description of durable Capture and visible Processing Attempts.";
    }
}

class ControllableTopicTagProvider implements TopicTagGenerationProvider {
    prompts: string[] = [];
    shouldFail = false;
    tags: GeneratedTopicTag[] = [
        { name: "Machine Learning", aliases: ["machine-learning"] },
        { name: "Neural Networks", aliases: [] },
    ];

    async generateTopicTags(prompt: string): Promise<GeneratedTopicTag[]> {
        this.prompts.push(prompt);
        if (this.shouldFail) throw new Error("Topic Tag provider unavailable");
        return this.tags;
    }
}

describe("Topic Tags", () => {
    test.skipIf(!process.env.TEST_DATABASE_URL)("generates canonical Topic Tags from Source Snapshot content and Capture Context for list, detail, and Recall", async () => {
        const embeddings = new DeterministicEmbeddingProvider();
        const topicTags = new ControllableTopicTagProvider();
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: embeddings }),
            (database, sourceServer) => createArticleProcessingWorker({
                database: database.db,
                sourceFetchOptions: sourceServer.safeFetchDependencies(),
                embeddingProvider: embeddings,
                summaryProvider: new StaticSummaryProvider(),
                topicTagProvider: topicTags,
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
        const capture = await captureResponse.json() as { knowledgeItemId: number };
        await harness.drainWorker();

        expect(topicTags.prompts[0]).toContain("Durable Capture stores a Source before asynchronous processing begins.");
        expect(topicTags.prompts[0]).toContain("Selected source text: Extraction keeps meaningful primary text.");
        expect(topicTags.prompts[0]).toContain("Personal note: Remember why Processing Attempts matter.");

        const expected = ["Machine Learning", "Neural Networks"];
        const list = await (await fetch(`${harness.apiBaseUrl}/knowledge-items`)).json();
        expect(list).toEqual([expect.objectContaining({ id: capture.knowledgeItemId, organizationCondition: "complete", topicTags: expected })]);
        expect(await (await fetch(`${harness.apiBaseUrl}/knowledge-items/${capture.knowledgeItemId}`)).json())
            .toEqual(expect.objectContaining({ topicTags: expected }));
        expect(await (await fetch(`${harness.apiBaseUrl}/search?q=${encodeURIComponent("Durable Capture")}`)).json())
            .toEqual([expect.objectContaining({ id: capture.knowledgeItemId, topicTags: expected })]);

        topicTags.tags = [
            { name: "machine-learning", aliases: ["Machine Learning", "ML"] },
            { name: "Neural Networks", aliases: [] },
        ];
        await fetch(`${harness.apiBaseUrl}/knowledge-items/${capture.knowledgeItemId}/refresh`, { method: "POST" });
        await harness.drainWorker();
        const storedTags = await harness.database.pool.query<{ canonical_name: string }>("SELECT canonical_name FROM topic_tags ORDER BY canonical_name");
        expect(storedTags.rows).toEqual([{ canonical_name: "Machine Learning" }, { canonical_name: "Neural Networks" }]);

        topicTags.tags = [
            { name: "ML", aliases: [] },
            { name: "Neural Networks", aliases: [] },
        ];
        await fetch(`${harness.apiBaseUrl}/knowledge-items/${capture.knowledgeItemId}/refresh`, { method: "POST" });
        await harness.drainWorker();
        expect(await (await fetch(`${harness.apiBaseUrl}/knowledge-items/${capture.knowledgeItemId}`)).json())
            .toEqual(expect.objectContaining({ topicTags: expected }));
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("keeps retrieval Ready and reports Organization incomplete when Topic Tag retries exhaust, then retries only organization work manually", async () => {
        const embeddings = new DeterministicEmbeddingProvider();
        const topicTags = new ControllableTopicTagProvider();
        topicTags.shouldFail = true;
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: embeddings }),
            (database, sourceServer) => createArticleProcessingWorker({
                database: database.db,
                sourceFetchOptions: sourceServer.safeFetchDependencies(),
                embeddingProvider: embeddings,
                summaryProvider: new StaticSummaryProvider(),
                topicTagProvider: topicTags,
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

        expect(await (await fetch(`${harness.apiBaseUrl}/knowledge-items/${capture.knowledgeItemId}`)).json()).toEqual(expect.objectContaining({
            availability: "ready",
            organizationCondition: "incomplete",
            latestAttempt: expect.objectContaining({ status: "failed", failureReason: "Topic Tag provider unavailable" }),
        }));

        topicTags.shouldFail = false;
        const retry = await fetch(`${harness.apiBaseUrl}/knowledge-items/${capture.knowledgeItemId}/retry`, { method: "POST" });
        expect(retry.status).toBe(202);
        await harness.drainWorker();
        expect(await (await fetch(`${harness.apiBaseUrl}/knowledge-items/${capture.knowledgeItemId}`)).json()).toEqual(expect.objectContaining({
            availability: "ready",
            organizationCondition: "complete",
            topicTags: ["Machine Learning", "Neural Networks"],
            latestAttempt: expect.objectContaining({ kind: "manual-retry", status: "completed" }),
        }));
        const retryStages = await harness.database.pool.query<{ kind: string; attempt_count: number }>(`
            SELECT stage.kind, stage.attempt_count
            FROM processing_stages AS stage
            INNER JOIN processing_attempts AS attempt ON attempt.id = stage.processing_attempt_id
            WHERE attempt.knowledge_item_id = $1 AND attempt.kind = 'manual-retry'
            ORDER BY stage.id
        `, [capture.knowledgeItemId]);
        expect(retryStages.rows).toEqual([
            { kind: "extraction", attempt_count: 0 },
            { kind: "snapshot-persistence", attempt_count: 0 },
            { kind: "passage-generation", attempt_count: 0 },
            { kind: "lexical-indexing", attempt_count: 0 },
            { kind: "semantic-indexing", attempt_count: 0 },
            { kind: "snapshot-activation", attempt_count: 0 },
            { kind: "recognition-summary-generation", attempt_count: 0 },
            { kind: "topic-tag-generation", attempt_count: 1 },
        ]);
    });
});

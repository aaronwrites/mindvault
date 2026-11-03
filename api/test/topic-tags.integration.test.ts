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

test.skipIf(!process.env.TEST_DATABASE_URL)("persists local canonical corrections through Refresh and re-add without changing other items", async () => {
    const embeddings = new DeterministicEmbeddingProvider();
    const provider = new ControllableTopicTagProvider();
    provider.tags[0]!.aliases.push("ML");
    harness = await createIntegrationHarness(
        database => createApp({ database: database.db, embeddingProvider: embeddings }),
        (database, server) => createArticleProcessingWorker({ database: database.db, sourceFetchOptions: server.safeFetchDependencies(), embeddingProvider: embeddings, summaryProvider: new StaticSummaryProvider(), topicTagProvider: provider }),
    );
    const request = (path: string, method = "GET", body?: unknown) => fetch(`${harness!.apiBaseUrl}${path}`, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
    const capture = async (url: string) => (await (await request("/captures", "POST", { url: harness!.sourceServer.fetchUrl(url) })).json() as { knowledgeItemId: number });
    const first = await capture("/articles/changed");
    const second = await capture("/articles/primary-text");
    await harness.drainWorker();
    const path = `/knowledge-items/${first.knowledgeItemId}`;
    const correct = (add: string[], remove: string[]) => request(`${path}/tags`, "PATCH", { add, remove });
    expect((await correct(["Deep Learning"], ["ML"])).status).toBe(200);
    const expected = ["Deep Learning", "Neural Networks"];
    expect(await (await request(path)).json()).toEqual(expect.objectContaining({ topicTags: expected }));
    expect(await (await request(`/knowledge-items/${second.knowledgeItemId}`)).json()).toEqual(expect.objectContaining({ topicTags: ["Machine Learning", "Neural Networks"] }));
    harness.sourceServer.setChangedArticleVersion(2);
    await request(`${path}/refresh`, "POST");
    await harness.drainWorker();
    expect(await (await request(path)).json()).toEqual(expect.objectContaining({ topicTags: expected }));
    expect(await (await request("/search?q=provenance")).json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: first.knowledgeItemId, topicTags: expected })]));
    expect((await correct(["ml", "deep-learning"], [])).status).toBe(200);
    expect(await (await request(path)).json()).toEqual(expect.objectContaining({ topicTags: ["Deep Learning", "Machine Learning", "Neural Networks"] }));
    for (const body of [{ add: [" "], remove: [] }, { add: ["x".repeat(101)], remove: [] }, { add: ["bad\nname"], remove: [] }, {}, { add: [3], remove: [] }]) expect((await request(`${path}/tags`, "PATCH", body)).status).toBe(400);
    await Promise.all([correct(["Robotics"], []), correct(["Computer Vision"], [])]);
    expect(await (await request(path)).json()).toEqual(expect.objectContaining({ topicTags: ["Computer Vision", "Deep Learning", "Machine Learning", "Neural Networks", "Robotics"] }));
    expect((await request("/knowledge-items/999999/tags", "PATCH", { add: ["ML"], remove: [] })).status).toBe(404);
    const longTag = "A".repeat(120);
    provider.tags = [{ name: longTag, aliases: [] }];
    await request(`${path}/refresh`, "POST");
    await harness.drainWorker();
    expect((await correct(["Short replacement"], [longTag])).status).toBe(200);
    expect(await (await request(path)).json()).toEqual(expect.objectContaining({ topicTags: ["Computer Vision", "Deep Learning", "Machine Learning", "Robotics", "Short replacement"] }));
    await request(`${path}/refresh`, "POST");
    await harness.drainWorker();
    expect(await (await request(path)).json()).toEqual(expect.objectContaining({ topicTags: ["Computer Vision", "Deep Learning", "Machine Learning", "Robotics", "Short replacement"] }));
    await request(`${path}/trash`, "POST");
    expect((await correct(["ML"], [])).status).toBe(404);
});

test.skipIf(!process.env.TEST_DATABASE_URL)("keeps corrections made during generation and through a failed organization retry", async () => {
    const embeddings = new DeterministicEmbeddingProvider();
    let path = "";
    let fail = false;
    let correctDuringGeneration = true;
    const request = (suffix: string, body: unknown) => fetch(`${harness!.apiBaseUrl}${path}${suffix}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    harness = await createIntegrationHarness(
        database => createApp({ database: database.db, embeddingProvider: embeddings }),
        (database, server) => createArticleProcessingWorker({ database: database.db, sourceFetchOptions: server.safeFetchDependencies(), embeddingProvider: embeddings, summaryProvider: new StaticSummaryProvider(), maxAttempts: 1, topicTagProvider: {
            async generateTopicTags() {
                if (fail) throw new Error("Offline");
                if (correctDuringGeneration) {
                    expect((await request("/tags", { add: ["Robotics"], remove: ["Machine Learning"] })).status).toBe(200);
                    correctDuringGeneration = false;
                }
                return [{ name: "Machine Learning", aliases: ["ML"] }];
            },
        } }),
    );
    const capture = await (await fetch(`${harness.apiBaseUrl}/captures`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: harness.sourceServer.fetchUrl("/articles/changed") }) })).json() as { knowledgeItemId: number };
    path = `/knowledge-items/${capture.knowledgeItemId}`;
    // Manual additions also work before any Source Snapshot exists.
    expect((await request("/tags", { add: ["Notes"], remove: [] })).status).toBe(200);
    await harness.drainWorker();
    const detail = async () => (await (await fetch(`${harness!.apiBaseUrl}${path}`)).json());
    expect(await detail()).toEqual(expect.objectContaining({ topicTags: ["Notes", "Robotics"] }));
    fail = true;
    await fetch(`${harness.apiBaseUrl}${path}/refresh`, { method: "POST" });
    await harness.drainWorker();
    expect(await detail()).toEqual(expect.objectContaining({ latestAttempt: expect.objectContaining({ status: "failed" }), topicTags: ["Notes", "Robotics"] }));
    fail = false;
    await fetch(`${harness.apiBaseUrl}${path}/retry`, { method: "POST" });
    await harness.drainWorker();
    expect(await detail()).toEqual(expect.objectContaining({ topicTags: ["Notes", "Robotics"] }));
    await request("/tags", { add: ["ML"], remove: [] });
    await fetch(`${harness.apiBaseUrl}${path}/refresh`, { method: "POST" });
    await harness.drainWorker();
    expect(await detail()).toEqual(expect.objectContaining({ topicTags: ["Machine Learning", "Notes", "Robotics"] }));
});

test.skipIf(!process.env.TEST_DATABASE_URL)("carries alias-item corrections into canonical identity reconciliation", async () => {
    const embeddings = new DeterministicEmbeddingProvider();
    const provider = new ControllableTopicTagProvider();
    harness = await createIntegrationHarness(database => createApp({ database: database.db, embeddingProvider: embeddings }), (database, server) => createArticleProcessingWorker({ database: database.db, sourceFetchOptions: server.safeFetchDependencies(), embeddingProvider: embeddings, summaryProvider: new StaticSummaryProvider(), topicTagProvider: provider }));
    const capture = async (url: string) => (await (await fetch(`${harness!.apiBaseUrl}/captures`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: harness!.sourceServer.fetchUrl(url) }) })).json() as { knowledgeItemId: number });
    await capture("/articles/canonical-target");
    await harness.drainWorker();
    const alias = await capture("/canonical");
    await fetch(`${harness.apiBaseUrl}/knowledge-items/${alias.knowledgeItemId}/tags`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ add: ["Robotics"], remove: ["Machine Learning"] }) });
    await harness.drainWorker();
    expect(await (await fetch(`${harness.apiBaseUrl}/knowledge-items`)).json()).toEqual([expect.objectContaining({ topicTags: ["Neural Networks", "Robotics"] })]);
});

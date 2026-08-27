import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { findSemanticPassages } from "../src/lib/passages/find-semantic-passages";
import type { EmbeddingProvider } from "../src/lib/ai/providers";
import { createArticleProcessingWorker } from "../src/worker";
import { DeterministicEmbeddingProvider, drainEligibleWork } from "./support/deterministic-runtime";
import { createIntegrationHarness, type IntegrationHarness } from "./support/integration-harness";

let harness: IntegrationHarness | undefined;

afterEach(async () => {
    await harness?.cleanup();
    harness = undefined;
});

class FixedCorpusEmbeddingProvider implements EmbeddingProvider {
    readonly representation: EmbeddingProvider["representation"];
    calls = 0;

    constructor(model = "fixed-corpus-v1") {
        this.representation = {
        provider: "test",
        model,
        dimensions: 768,
        metadata: { normalization: "unit-length", task: "retrieval-document" },
        };
    }

    async embed(text: string): Promise<number[]> {
        this.calls += 1;
        return this.vectorFor(text);
    }

    async embedQuery(text: string): Promise<number[]> {
        return this.vectorFor(text);
    }

    private vectorFor(text: string): number[] {
        const vectorIndex = fixedCorpusVectors.get(text);
        if (vectorIndex === undefined) throw new Error(`No fixed corpus vector is defined for: ${text}`);
        const vector = Array<number>(768).fill(0);
        vector[vectorIndex] = 1;
        return vector;
    }
}

const retainedPassage = "MindVault preserves useful article text in a durable Source Snapshot so the knowledge remains available when the original website changes or disappears. This fixture supplies enough meaningful primary text for trustworthy conceptual retrieval after a public article is no longer available at its original address.";
const unrelatedPassage = "This fixture explains how PostgreSQL text search supports exact technical identifiers such as error messages, version numbers, and command-line flags. Its deliberately unrelated topic makes the expected conceptual match a property of the fixed corpus rather than the fake embedding provider's implementation.";
const retentionQuery = "How can I remember an article after its original site changes?";
const fixedCorpusVectors = new Map([
    [retainedPassage, 0],
    [unrelatedPassage, 1],
    [retentionQuery, 0],
]);

describe("Semantic Passage indexing", () => {
    test.skipIf(!process.env.TEST_DATABASE_URL)("keeps an item Ready when a Refresh fails after retaining an older indexed Source Snapshot", async () => {
        const embeddings = new DeterministicEmbeddingProvider();
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: embeddings }),
            (database, sourceServer) => createArticleProcessingWorker({
                database: database.db,
                sourceFetchOptions: sourceServer.safeFetchDependencies(),
                embeddingProvider: embeddings,
            }),
        );
        const capture = async () => {
            const response = await fetch(`${harness!.apiBaseUrl}/captures`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ url: harness!.sourceServer.fetchUrl("/articles/changed") }),
            });
            expect(response.status).toBe(201);
            return response.json() as Promise<{ knowledgeItemId: number }>;
        };

        const firstCapture = await capture();
        await harness.drainWorker();
        harness.sourceServer.setChangedArticleVersion(2);
        const refreshResponse = await fetch(`${harness.apiBaseUrl}/knowledge-items/${firstCapture.knowledgeItemId}/refresh`, {
            method: "POST",
        });
        expect(refreshResponse.status).toBe(202);

        const failedRefreshWorker = createArticleProcessingWorker({
            database: harness.database.db,
            sourceFetchOptions: harness.sourceServer.safeFetchDependencies(),
            embeddingProvider: new FailingEmbeddingProvider(),
            maxAttempts: 1,
        });
        await drainEligibleWork(failedRefreshWorker);

        const itemResponse = await fetch(`${harness.apiBaseUrl}/knowledge-items/${firstCapture.knowledgeItemId}`);
        expect(await itemResponse.json()).toEqual(expect.objectContaining({
            availability: "ready",
            latestAttempt: expect.objectContaining({
                kind: "refresh",
                status: "failed",
                failureReason: "embedding provider unavailable",
            }),
        }));
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("becomes Ready after a current Source Snapshot has complete lexical and semantic Passage indexes", async () => {
        const embeddings = new FixedCorpusEmbeddingProvider();
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: embeddings }),
            (database, sourceServer) => createArticleProcessingWorker({
                database: database.db,
                sourceFetchOptions: sourceServer.safeFetchDependencies(),
                embeddingProvider: embeddings,
            }),
        );

        const captureResponse = await fetch(`${harness.apiBaseUrl}/captures`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: harness.sourceServer.fetchUrl("/articles/semantic-retention") }),
        });
        const capture = await captureResponse.json() as { knowledgeItemId: number; availability: string };
        expect(captureResponse.status).toBe(201);
        expect(capture.availability).toBe("processing");

        await harness.drainWorker();

        const knowledgeItemResponse = await fetch(`${harness.apiBaseUrl}/knowledge-items/${capture.knowledgeItemId}`);
        expect(knowledgeItemResponse.status).toBe(200);
        expect(await knowledgeItemResponse.json()).toEqual(expect.objectContaining({ availability: "ready" }));
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("persists a complete compatible representation and recalls a fixed conceptual match", async () => {
        const embeddings = new FixedCorpusEmbeddingProvider();
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: embeddings }),
            (database, sourceServer) => createArticleProcessingWorker({
                database: database.db,
                sourceFetchOptions: sourceServer.safeFetchDependencies(),
                embeddingProvider: embeddings,
            }),
        );

        for (const path of ["/articles/semantic-retention", "/articles/semantic-unrelated"]) {
            const response = await fetch(`${harness.apiBaseUrl}/captures`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ url: harness.sourceServer.fetchUrl(path) }),
            });
            expect(response.status).toBe(201);
            await harness.drainWorker();
        }

        const representations = await harness.database.pool.query<{
            text: string;
            provider: string;
            model: string;
            dimensions: number;
            metadata: Record<string, string>;
        }>(`
            SELECT passages.text, passage_embeddings.provider, passage_embeddings.model,
                passage_embeddings.dimensions, passage_embeddings.metadata
            FROM passages
            JOIN passage_embeddings ON passage_embeddings.passage_id = passages.id
            ORDER BY passages.id
        `);
        expect(representations.rows).toEqual(expect.arrayContaining([
            expect.objectContaining({
                text: expect.stringContaining("preserves useful article text"),
                provider: "test",
                model: "fixed-corpus-v1",
                dimensions: 768,
                metadata: { normalization: "unit-length", task: "retrieval-document" },
            }),
        ]));

        const matches = await findSemanticPassages(harness.database.db, retentionQuery, embeddings);
        expect(matches[0]).toEqual(expect.objectContaining({ text: expect.stringContaining("preserves useful article text") }));
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("reuses compatible embeddings and replaces an incompatible representation", async () => {
        const firstProvider = new FixedCorpusEmbeddingProvider("fixed-corpus-v1");
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: firstProvider }),
            (database, sourceServer) => createArticleProcessingWorker({
                database: database.db,
                sourceFetchOptions: sourceServer.safeFetchDependencies(),
                embeddingProvider: firstProvider,
            }),
        );
        const capture = async () => {
            const response = await fetch(`${harness!.apiBaseUrl}/captures`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ url: harness!.sourceServer.fetchUrl("/articles/semantic-retention") }),
            });
            expect(response.status).toBe(201);
            await harness!.drainWorker();
            return response.json() as Promise<{ knowledgeItemId: number }>;
        };

        const firstCapture = await capture();
        expect(firstProvider.calls).toBe(1);
        await capture();
        expect(firstProvider.calls).toBe(1);

        const response = await fetch(`${harness.apiBaseUrl}/knowledge-items/${firstCapture.knowledgeItemId}/refresh`, {
            method: "POST",
        });
        expect(response.status).toBe(202);

        const replacementProvider = new FixedCorpusEmbeddingProvider("fixed-corpus-v2");
        const replacementWorker = createArticleProcessingWorker({
            database: harness.database.db,
            sourceFetchOptions: harness.sourceServer.safeFetchDependencies(),
            embeddingProvider: replacementProvider,
        });
        await drainEligibleWork(replacementWorker);
        expect(replacementProvider.calls).toBe(1);
        const models = await harness.database.pool.query<{ model: string }>("SELECT DISTINCT model FROM passage_embeddings");
        expect(models.rows).toEqual([{ model: "fixed-corpus-v2" }]);
        const itemResponse = await fetch(`${harness.apiBaseUrl}/knowledge-items/${firstCapture.knowledgeItemId}`);
        expect(await itemResponse.json()).toEqual(expect.objectContaining({ availability: "processing" }));
    });
});

class FailingEmbeddingProvider implements EmbeddingProvider {
    readonly representation = new DeterministicEmbeddingProvider().representation;

    async embed(): Promise<number[]> {
        throw new Error("embedding provider unavailable");
    }

    async embedQuery(): Promise<number[]> {
        throw new Error("embedding provider unavailable");
    }
}

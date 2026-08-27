import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import type { EmbeddingProvider } from "../src/lib/ai/providers";
import { createArticleProcessingWorker } from "../src/worker";
import { createIntegrationHarness, type IntegrationHarness } from "./support/integration-harness";

let harness: IntegrationHarness | undefined;

afterEach(async () => {
    await harness?.cleanup();
    harness = undefined;
});

const retainedPassage = "MindVault preserves useful article text in a durable Source Snapshot so the knowledge remains available when the original website changes or disappears. This fixture supplies enough meaningful primary text for trustworthy conceptual retrieval after a public article is no longer available at its original address.";
const unrelatedPassage = "This fixture explains how PostgreSQL text search supports exact technical identifiers such as error messages, version numbers, and command-line flags. Its deliberately unrelated topic makes the expected conceptual match a property of the fixed corpus rather than the fake embedding provider's implementation.";
const lexicalPassage = "Run the git rebase --autosquash command before publishing. Pass the --max-old-space-size=4096 flag to Node.js when a build needs more memory. The service reported the error message EADDRINUSE while binding its listener. OAuth2 is the authorization protocol used by this fixture. PostgreSQL 18 supplies the text-search index. The deployment identifier release-2026-08-25 must remain traceable through processing history. This deliberately detailed corpus verifies exact-language Passage retrieval across commands, flags, error messages, acronyms, versions, and identifiers.";

class RecallCorpusEmbeddingProvider implements EmbeddingProvider {
    readonly representation = {
        provider: "test",
        model: "recall-corpus-v1",
        dimensions: 768,
        metadata: { normalization: "unit-length", task: "retrieval-document" },
    };

    async embed(text: string): Promise<number[]> {
        return this.vectorFor(text);
    }

    async embedQuery(text: string): Promise<number[]> {
        return this.vectorFor(text);
    }

    private vectorFor(text: string): number[] {
        const dimension = new Map([
            [retainedPassage, 0],
            [unrelatedPassage, 1],
            [lexicalPassage, 2],
            ["How can I remember an article after its original site changes?", 0],
            ["EADDRINUSE", 2],
            ["durable Source Snapshot", 0],
            ["My reason for saving this is the durable Source Snapshot.", 0],
            ["something absent from this corpus", 7],
        ]).get(text);
        if (dimension === undefined) throw new Error(`No fixed corpus vector is defined for: ${text}`);
        const vector = Array<number>(768).fill(0);
        vector[dimension] = 1;
        return vector;
    }
}

describe("Knowledge Item Recall", () => {
    test.skipIf(!process.env.TEST_DATABASE_URL)("returns ranked Knowledge Items with grounded conceptual and exact-language Passage evidence", async () => {
        const embeddings = new RecallCorpusEmbeddingProvider();
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: embeddings }),
            (database, sourceServer) => createArticleProcessingWorker({
                database: database.db,
                sourceFetchOptions: sourceServer.safeFetchDependencies(),
                embeddingProvider: embeddings,
            }),
        );
        const activeHarness = harness;

        const capture = async (path: string, input: Record<string, string> = {}) => {
            const response = await fetch(`${activeHarness.apiBaseUrl}/captures`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ url: activeHarness.sourceServer.fetchUrl(path), ...input }),
            });
            expect(response.status).toBe(201);
            await activeHarness.drainWorker();
        };
        await capture("/articles/semantic-retention");
        await capture("/articles/lexical-corpus");

        const conceptualResponse = await fetch(`${activeHarness.apiBaseUrl}/search?q=${encodeURIComponent("How can I remember an article after its original site changes?")}`);
        expect(conceptualResponse.status).toBe(200);
        const conceptualResults = await conceptualResponse.json() as Array<{ title: string; excerpts: Array<{ text: string; origin: string; sourceSnapshot: { originalUrl: string } | null }>; ranking: { score: number } }>;
        expect(conceptualResults[0]).toEqual(expect.objectContaining({
            title: "Retained knowledge",
            excerpts: [expect.objectContaining({
                text: retainedPassage,
                origin: "source-snapshot",
                sourceSnapshot: expect.objectContaining({ originalUrl: activeHarness.sourceServer.fetchUrl("/articles/semantic-retention") }),
            })],
            ranking: expect.objectContaining({ score: expect.any(Number) }),
        }));

        const exactResponse = await fetch(`${activeHarness.apiBaseUrl}/search?q=EADDRINUSE`);
        expect(exactResponse.status).toBe(200);
        const exactResults = await exactResponse.json() as Array<{ title: string; excerpts: Array<{ text: string }> }>;
        expect(exactResults[0]).toEqual(expect.objectContaining({
            title: "Lexical corpus",
            excerpts: [expect.objectContaining({ text: lexicalPassage })],
        }));

        await capture("/articles/semantic-unrelated", { personalNote: "My reason for saving this is the durable Source Snapshot." });

        const contextResponse = await fetch(`${activeHarness.apiBaseUrl}/search?q=${encodeURIComponent("durable Source Snapshot")}`);
        expect(contextResponse.status).toBe(200);
        const contextResults = await contextResponse.json() as Array<{ source: { submittedUrl: string }; excerpts: Array<{ text: string; origin: string }> }>;
        expect(contextResults[0]).toEqual(expect.objectContaining({
            source: expect.objectContaining({ submittedUrl: activeHarness.sourceServer.fetchUrl("/articles/semantic-unrelated") }),
            excerpts: [expect.objectContaining({
                text: "My reason for saving this is the durable Source Snapshot.",
                origin: "personal-note",
            })],
        }));

        const emptyResponse = await fetch(`${activeHarness.apiBaseUrl}/search?q=${encodeURIComponent("something absent from this corpus")}`);
        expect(emptyResponse.status).toBe(200);
        expect(await emptyResponse.json()).toEqual([]);
    });
});

import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { createOllamaProviders } from "../src/lib/ai/ollama";
import { findSemanticPassages } from "../src/lib/passages/find-semantic-passages";
import { createArticleProcessingWorker } from "../src/worker";
import { createIntegrationHarness, type IntegrationHarness } from "./support/integration-harness";

let harness: IntegrationHarness | undefined;

afterEach(async () => {
    await harness?.cleanup();
    harness = undefined;
});

describe("live local Ollama acceptance", () => {
    test.skipIf(process.env.RUN_LIVE_OLLAMA_CHECK !== "1" || !process.env.TEST_DATABASE_URL)("processes and retrieves an isolated representative collection", async () => {
        const providers = createOllamaProviders();
        await providers.preflight();
        const timings: Record<string, number> = {};
        harness = await createIntegrationHarness(
            database => createApp({
                database: database.db,
                embeddingProvider: providers.embeddingProvider,
                synthesisProvider: providers.synthesisProvider,
            }),
            (database, sourceServer) => createArticleProcessingWorker({
                database: database.db,
                sourceFetchOptions: sourceServer.safeFetchDependencies(),
                embeddingProvider: providers.embeddingProvider,
                summaryProvider: providers.summaryProvider,
                topicTagProvider: providers.topicTagProvider,
                maxAttempts: 1,
            }),
        );

        const capture = async (name: string, path: string) => {
            const started = performance.now();
            const response = await fetch(`${harness!.apiBaseUrl}/captures`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ url: harness!.sourceServer.fetchUrl(path) }),
            });
            expect(response.status).toBe(201);
            const result = await response.json() as { knowledgeItemId: number };
            await harness!.drainWorker();
            timings[name] = Math.round(performance.now() - started);
            return result;
        };

        const primary = await capture("primaryCapture", "/articles/primary-text");
        const metadata = await capture("metadataCapture", "/metadata/title-only");
        const inaccessible = await capture("inaccessibleCapture", "/authentication");

        const primaryItem = await fetch(`${harness.apiBaseUrl}/knowledge-items/${primary.knowledgeItemId}`).then(response => response.json()) as {
            availability: string; recognitionSummary?: string; topicTags: string[];
        };
        const metadataItem = await fetch(`${harness.apiBaseUrl}/knowledge-items/${metadata.knowledgeItemId}`).then(response => response.json()) as {
            availability: string; recognitionSummary?: string; topicTags: string[];
        };
        const inaccessibleItem = await fetch(`${harness.apiBaseUrl}/knowledge-items/${inaccessible.knowledgeItemId}`).then(response => response.json()) as { availability: string };
        expect(primaryItem).toEqual(expect.objectContaining({ availability: "ready", recognitionSummary: expect.any(String) }));
        expect(primaryItem.topicTags.length).toBeGreaterThan(0);
        expect(metadataItem).toEqual(expect.objectContaining({ availability: "ready", recognitionSummary: expect.any(String) }));
        expect(metadataItem.topicTags.length).toBeGreaterThan(0);
        expect(inaccessibleItem.availability).toBe("needs-attention");

        const call = async (name: string, url: string, init?: RequestInit) => {
            const started = performance.now();
            const response = await fetch(url, init);
            timings[name] = Math.round(performance.now() - started);
            expect(response.status).toBe(200);
            return response.json();
        };
        const exactRecall = await call("exactRecall", `${harness.apiBaseUrl}/search?q=${encodeURIComponent("Processing Attempts")}`) as Array<{ id: number }>;
        const conceptualRecall = await call("conceptualRecall", `${harness.apiBaseUrl}/search?q=${encodeURIComponent("How are failures kept visible without losing a saved page?")}`) as Array<{ id: number }>;
        expect(exactRecall.some(item => item.id === primary.knowledgeItemId)).toBe(true);
        expect(conceptualRecall.some(item => item.id === primary.knowledgeItemId)).toBe(true);

        const ask = (name: string, body: unknown) => call(name, `${harness!.apiBaseUrl}/synthesis`, {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
        });
        const primaryAnswer = await ask("primaryAnswer", { question: "How does MindVault keep processing failures visible?" }) as { answer: string; citations: unknown[]; insufficientEvidence: boolean };
        const metadataAnswer = await ask("metadataAnswer", { question: "What technology keeps read models current?" }) as { citations: Array<{ evidenceCoverage: string }> };
        const followUp = await ask("followUp", {
            question: "What does it preserve for later retrieval?",
            conversation: [{ question: "How does MindVault keep processing failures visible?", answer: primaryAnswer.answer }],
        }) as { citations: unknown[] };
        const unanswerable = await ask("unanswerable", { question: "What was the rainfall in Mumbai yesterday?" }) as { insufficientEvidence: boolean; citations: unknown[] };
        expect(primaryAnswer.insufficientEvidence).toBe(false);
        expect(primaryAnswer.citations.length).toBeGreaterThan(0);
        expect(metadataAnswer.citations.some(citation => citation.evidenceCoverage === "metadata-only")).toBe(true);
        expect(followUp.citations.length).toBeGreaterThan(0);
        expect(unanswerable).toEqual(expect.objectContaining({ insufficientEvidence: true, citations: [] }));

        const semanticDistances = {
            exact: await findSemanticPassages(harness.database.db, "Processing Attempts", providers.embeddingProvider),
            conceptual: await findSemanticPassages(harness.database.db, "How are failures kept visible without losing a saved page?", providers.embeddingProvider),
            unanswerable: await findSemanticPassages(harness.database.db, "What was the rainfall in Mumbai yesterday?", providers.embeddingProvider),
        };

        console.log(JSON.stringify({
            models: providers.modelDigests,
            timingsMs: timings,
            semanticDistanceCutoff: { configured: 0.4, candidates: semanticDistances },
            outputs: { primaryItem, metadataItem, inaccessibleItem, exactRecall, conceptualRecall, primaryAnswer, metadataAnswer, followUp, unanswerable },
            assessmentNeeded: "Review grounding and retrieval relevance, including the semantic-distance cutoff, before accepting local model quality.",
        }, null, 2));
    }, 20 * 60_000);
});

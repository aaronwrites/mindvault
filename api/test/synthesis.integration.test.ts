import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import type { EmbeddingProvider, SynthesisGenerationInput, SynthesisGenerationProvider } from "../src/lib/ai/providers";
import { createArticleProcessingWorker } from "../src/worker";
import { DeterministicGenerationProvider, DeterministicTopicTagGenerationProvider } from "./support/deterministic-runtime";
import { createIntegrationHarness, type IntegrationHarness } from "./support/integration-harness";

let harness: IntegrationHarness | undefined;

afterEach(async () => {
    await harness?.cleanup();
    harness = undefined;
});

class SynthesisCorpusEmbeddingProvider implements EmbeddingProvider {
    readonly representation = {
        provider: "test",
        model: "synthesis-corpus-v1",
        dimensions: 768,
        metadata: { normalization: "unit-length" },
    };

    async embed(text: string): Promise<number[]> {
        const vector = Array<number>(768).fill(0);
        vector[/security|password|cloudflare/i.test(text) ? 2 : /logical replication|read models/i.test(text) ? 1 : /capital of France/i.test(text) ? 7 : 0] = 1;
        return vector;
    }

    embedQuery(text: string): Promise<number[]> {
        return this.embed(text);
    }
}

class ControlledSynthesisProvider implements SynthesisGenerationProvider {
    inputs: SynthesisGenerationInput[] = [];
    fail = false;
    insufficientEvidence = false;

    async generateSynthesis(input: SynthesisGenerationInput) {
        this.inputs.push(input);
        if (this.fail) throw new Error("controlled provider failure");
        return {
            answer: this.insufficientEvidence ? "The retrieved evidence does not answer that question." : `Grounded answer: ${input.evidence[0]?.text}`,
            citationIds: this.insufficientEvidence ? [] : input.evidence.slice(0, 1).map(evidence => evidence.citationId),
            insufficientEvidence: this.insufficientEvidence,
        };
    }
}

describe("collection-wide Synthesis", () => {
    test.skipIf(!process.env.TEST_DATABASE_URL)("answers from retrieved primary and metadata-only evidence, with resolvable citations and honest failures", async () => {
        const embeddings = new SynthesisCorpusEmbeddingProvider();
        const synthesisProvider = new ControlledSynthesisProvider();
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: embeddings, synthesisProvider }),
            (database, sourceServer) => createArticleProcessingWorker({
                database: database.db,
                sourceFetchOptions: sourceServer.safeFetchDependencies(),
                embeddingProvider: embeddings,
                summaryProvider: new DeterministicGenerationProvider(),
                topicTagProvider: new DeterministicTopicTagGenerationProvider(),
            }),
        );

        const capture = async (path: string) => {
            const response = await fetch(`${harness!.apiBaseUrl}/captures`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ url: harness!.sourceServer.fetchUrl(path) }),
            });
            expect(response.status).toBe(201);
            const result = await response.json() as { knowledgeItemId: number };
            await harness!.drainWorker();
            return result;
        };

        const primary = await capture("/articles/semantic-retention");
        const security = await capture("/articles/access-language");
        const metadataOnly = await capture("/metadata/title-only");

        const primaryQuestion = "How does a durable Source Snapshot preserve knowledge?";
        const primaryResponse = await fetch(`${harness.apiBaseUrl}/synthesis`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ question: primaryQuestion }),
        });
        expect(primaryResponse.status).toBe(200);
        expect(await primaryResponse.json()).toEqual(expect.objectContaining({
            answer: expect.stringContaining("MindVault preserves useful article text"),
            citations: [expect.objectContaining({
                knowledgeItemId: primary.knowledgeItemId,
                sourceSnapshotId: expect.any(Number),
                evidenceCoverage: "primary-content",
            })],
        }));
        expect(synthesisProvider.inputs[0]?.evidence).toEqual([expect.objectContaining({
            evidenceCoverage: "primary-content",
            originalUrl: harness.sourceServer.fetchUrl("/articles/semantic-retention"),
        })]);

        const followUpQuestion = "What about its security?";
        const followUpResponse = await fetch(`${harness.apiBaseUrl}/synthesis`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({
                question: followUpQuestion,
                conversation: [{ question: primaryQuestion, answer: "It preserves evidence from the captured page." }],
            }),
        });
        expect(followUpResponse.status).toBe(200);
        expect(await followUpResponse.json()).toEqual(expect.objectContaining({
            citations: [expect.objectContaining({ knowledgeItemId: security.knowledgeItemId })],
        }));
        expect(synthesisProvider.inputs[1]).toEqual(expect.objectContaining({
            question: followUpQuestion,
            conversation: [{ question: primaryQuestion, answer: "It preserves evidence from the captured page." }],
            evidence: [expect.objectContaining({ knowledgeItemId: security.knowledgeItemId })],
        }));

        const metadataResponse = await fetch(`${harness.apiBaseUrl}/synthesis`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ question: "What keeps read models current through logical replication?" }),
        });
        expect(metadataResponse.status).toBe(200);
        expect(await metadataResponse.json()).toEqual(expect.objectContaining({
            citations: [expect.objectContaining({
                knowledgeItemId: metadataOnly.knowledgeItemId,
                evidenceCoverage: "metadata-only",
            })],
        }));
        expect(synthesisProvider.inputs[2]?.evidence).toEqual([expect.objectContaining({
            evidenceCoverage: "metadata-only",
            text: "Source-provided title: How PostgreSQL logical replication keeps read models current",
        })]);

        synthesisProvider.insufficientEvidence = true;
        const retrievedButInsufficient = await fetch(`${harness.apiBaseUrl}/synthesis`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ question: "How does a durable Source Snapshot preserve knowledge?" }),
        });
        expect(retrievedButInsufficient.status).toBe(200);
        expect(await retrievedButInsufficient.json()).toEqual({
            answer: "The retrieved evidence does not answer that question.",
            citations: [],
            insufficientEvidence: true,
        });
        synthesisProvider.insufficientEvidence = false;

        const callsBeforeInsufficientEvidence = synthesisProvider.inputs.length;
        const insufficientEvidence = await fetch(`${harness.apiBaseUrl}/synthesis`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ question: "What is the capital of France?" }),
        });
        expect(insufficientEvidence.status).toBe(200);
        expect(await insufficientEvidence.json()).toEqual({
            answer: "I don't have enough captured evidence to answer that question.",
            citations: [],
            insufficientEvidence: true,
        });
        expect(synthesisProvider.inputs).toHaveLength(callsBeforeInsufficientEvidence);

        synthesisProvider.fail = true;
        const generationFailure = await fetch(`${harness.apiBaseUrl}/synthesis`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ question: "How does a durable Source Snapshot preserve knowledge?" }),
        });
        expect(generationFailure.status).toBe(502);
        expect(await generationFailure.json()).toEqual({ error: "Answer generation is temporarily unavailable. Please try again." });

        const trashed = await fetch(`${harness.apiBaseUrl}/knowledge-items/${primary.knowledgeItemId}/trash`, { method: "POST" });
        expect(trashed.status).toBe(204);
        const trashedSecurity = await fetch(`${harness.apiBaseUrl}/knowledge-items/${security.knowledgeItemId}/trash`, { method: "POST" });
        expect(trashedSecurity.status).toBe(204);
        synthesisProvider.fail = false;
        const trashExcluded = await fetch(`${harness.apiBaseUrl}/synthesis`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({
                question: followUpQuestion,
                conversation: [{ question: primaryQuestion, answer: "It preserves evidence from the captured page." }],
            }),
        });
        expect(await trashExcluded.json()).toEqual({
            answer: "I don't have enough captured evidence to answer that question.",
            citations: [],
            insufficientEvidence: true,
        });
    });
});

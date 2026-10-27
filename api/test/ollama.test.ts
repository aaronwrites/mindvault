import { describe, expect, test } from "bun:test";
import { createOllamaProviders, OllamaProviderError, type OllamaConfiguration } from "../src/lib/ai/ollama";

const configuration: OllamaConfiguration = {
    baseUrl: "http://ollama.test",
    generationModel: "gemma3:latest",
    embeddingModel: "nomic-embed-text:latest",
};

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function chatResponse(content: string): Response {
    return json({ message: { role: "assistant", content }, done: true });
}

describe("Ollama providers", () => {
    test("requests a bounded structured Recognition Summary and returns its text", async () => {
        const requests: Array<Record<string, unknown>> = [];
        let summary = "Explains JavaScript closures and lexical scoping.";
        const providers = createOllamaProviders({ configuration, fetchImplementation: async (_url, init) => { requests.push(JSON.parse(String(init?.body))); return chatResponse(JSON.stringify({ summary })); } });
        expect(await providers.summaryProvider.generate("Summarize the captured closures guide.")).toBe(summary);
        expect(requests[0]?.format).toEqual(expect.objectContaining({ properties: expect.objectContaining({ summary: expect.objectContaining({ maxLength: 320 }) }) }));
        summary = "x".repeat(321);
        await expect(providers.summaryProvider.generate("evidence")).rejects.toThrow("failed validation");
    });

    test("selects complete obtained statements for PDF Recognition Summaries", async () => {
        const providers = createOllamaProviders({ configuration, fetchImplementation: async () => chatResponse(JSON.stringify({ statementIndexes: [0] })) });
        const result = await providers.summaryProvider.generate("Summarize this PDF.", {
            sourceText: "PostgreSQL printed recovery checklist\nRestore the base backup before replaying archived WAL.\nSCAN_RECOVERY_MARKER identifies the printed recovery procedure.",
            extractionDisclosure: "All pages extracted.", partial: false,
        });
        expect(result).toBe("PostgreSQL printed recovery checklist Restore the base backup before replaying archived WAL.");
    });

    test("repairs invented technical identifiers using only the cited page evidence", async () => {
        const responses = [
            { answer: "Use WAL_RECOVERY_MARKER.", citationIds: ["page-2"], insufficientEvidence: false },
            { answer: "Use SCAN_RECOVERY_MARKER.", citationIds: ["page-2"], insufficientEvidence: false },
            { supported: true, reason: "The exact identifier occurs on the cited page." },
        ];
        const providers = createOllamaProviders({ configuration, fetchImplementation: async () => chatResponse(JSON.stringify(responses.shift())) });
        const result = await providers.synthesisProvider.generateSynthesis({
            question: "Which identifier appears in the checklist?", conversation: [], evidence: [{
                citationId: "page-2", origin: "source-snapshot", knowledgeItemId: 1, sourceSnapshotId: 1,
                title: "Recovery", text: "Identifier: SCAN_RECOVERY_MARKER.", originalUrl: null,
                pageNumber: 2, evidenceCoverage: "primary-content",
            }],
        });
        expect(result).toEqual({ answer: "Use SCAN_RECOVERY_MARKER.", citationIds: ["page-2"], insufficientEvidence: false });
    });

    test("fails closed when PDF statement selections remain outside obtained text", async () => {
        let generations = 0;
        const providers = createOllamaProviders({ configuration, fetchImplementation: async () => {
            generations++;
            return chatResponse(JSON.stringify({ statementIndexes: [999] }));
        } });
        await expect(providers.summaryProvider.generate("Summarize the PDF.", {
            sourceText: "Restore the base backup.", extractionDisclosure: "All text extracted.", partial: false,
        })).rejects.toThrow("grounding failed after one correction");
        expect(generations).toBe(2);
    });

    test("does not let an uncited page substantiate a synthesis claim", async () => {
        const providers = createOllamaProviders({ configuration, fetchImplementation: async () => chatResponse(JSON.stringify({
            answer: "Use EXACT_OTHER_NAME.", citationIds: ["cited"], insufficientEvidence: false,
        })) });
        const evidence = ["cited", "uncited"].map(citationId => ({
            citationId, origin: "source-snapshot" as const, knowledgeItemId: 1, sourceSnapshotId: 1,
            title: "EXACT_OTHER_NAME", originalUrl: null, evidenceCoverage: "primary-content" as const,
            text: citationId === "cited" ? "Restore the base backup." : "Use EXACT_OTHER_NAME.",
        }));
        await expect(providers.synthesisProvider.generateSynthesis({ question: "Which identifier?", evidence, conversation: [] }))
            .rejects.toThrow("grounding failed after one correction");
    });

    test("reports grounding input overflow without omitting source text", async () => {
        const providers = createOllamaProviders({ configuration, fetchImplementation: async () => chatResponse(JSON.stringify({ summary: "A recovery checklist." })) });
        await expect(providers.summaryProvider.generate("Summarize the PDF.", {
            sourceText: "x".repeat(28_001), extractionDisclosure: "All pages extracted.", partial: false,
        })).rejects.toThrow("maximum is 28000 bytes");
    });

    test("keeps PDF summaries bounded and discloses partial extraction without truncating a statement", async () => {
        const responses = [{ statementIndexes: [0] }, { statementIndexes: [1] }];
        const providers = createOllamaProviders({ configuration, fetchImplementation: async () => chatResponse(JSON.stringify(responses.shift())) });
        const result = await providers.summaryProvider.generate("Summarize the PDF.", {
            sourceText: `${"Long source statement ".repeat(20)}.\nRestore the base backup.`, extractionDisclosure: "Physical page 3 unreadable.", partial: true,
        });
        expect(result).toBe("From partially extracted PDF text: Restore the base backup.");
    });

    test("preserves negation across wrapped PDF lines in a selected statement", async () => {
        const providers = createOllamaProviders({ configuration, fetchImplementation: async () => chatResponse(JSON.stringify({ statementIndexes: [0] })) });
        const result = await providers.summaryProvider.generate("Summarize the PDF.", {
            sourceText: "Do not\nreplay archived WAL before restoring the base backup.", extractionDisclosure: "All text extracted.", partial: false,
        });
        expect(result).toBe("Do not replay archived WAL before restoring the base backup.");
    });

    test("does not accept generated prose in place of PDF source-statement selection", async () => {
        const providers = createOllamaProviders({ configuration, fetchImplementation: async () => chatResponse(JSON.stringify({ summary: "An invented workflow." })) });
        await expect(providers.summaryProvider.generate("Summarize the PDF.", {
            sourceText: "Restore the base backup.", extractionDisclosure: "All text extracted.", partial: false,
        })).rejects.toThrow("failed validation");
    });

    test("does not expose factual claims hidden inside an insufficient-evidence response", async () => {
        const providers = createOllamaProviders({ configuration, fetchImplementation: async () => chatResponse(JSON.stringify({
            answer: "The diagram shows a replication relationship, but evidence is insufficient.", citationIds: [], insufficientEvidence: true,
        })) });
        const result = await providers.synthesisProvider.generateSynthesis({ question: "What does the diagram show?", evidence: [], conversation: [] });
        expect(result).toEqual({ answer: "I don't have enough captured evidence to answer that question.", citationIds: [], insufficientEvidence: true });
    });

    test("resolves conversational references through structured generation and rejects unusable retrieval questions", async () => {
        const requests: string[] = [];
        let content = JSON.stringify({ question: "What does a durable Source Snapshot preserve?" });
        const providers = createOllamaProviders({ configuration, fetchImplementation: async (_url, init) => { requests.push(String(init?.body)); return chatResponse(content); } });
        const input = { question: "What does it preserve?", conversation: [{ question: "What is a Source Snapshot?", answer: "A retained representation of evidence." }] };
        expect(await providers.synthesisProvider.resolveQuestion(input)).toBe("What does a durable Source Snapshot preserve?");
        await providers.synthesisProvider.resolveQuestion({ question: input.question, conversation: Array.from({ length: 6 }, () => ({ question: "🧠".repeat(1_000), answer: "🧠".repeat(2_000) })) });
        const request = JSON.parse(requests.at(-1)!) as { messages: Array<{ content: string }> };
        expect(Buffer.byteLength(request.messages[0]!.content)).toBeLessThanOrEqual(28_000);
        content = JSON.stringify({ question: "" });
        await expect(providers.synthesisProvider.resolveQuestion(input)).rejects.toThrow("failed validation");
    });

    test("uses schema-constrained non-streaming chat with bounded generation options", async () => {
        const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
        const providers = createOllamaProviders({
            configuration,
            fetchImplementation: async (url, init) => {
                requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
                return chatResponse(JSON.stringify([
                    { name: "Local AI", aliases: ["On-device AI"] },
                    { name: "Knowledge Management", aliases: [] },
                    { name: "Privacy", aliases: [] },
                ]));
            },
        });

        expect(await providers.topicTagProvider.generateTopicTags("source evidence")).toHaveLength(3);
        expect(requests[0]).toEqual(expect.objectContaining({ url: "http://ollama.test/api/chat" }));
        expect(requests[0]?.body).toEqual(expect.objectContaining({
            model: "gemma3:latest",
            stream: false,
            format: expect.objectContaining({ type: "array" }),
            options: { num_ctx: 32768, temperature: 0.2, num_predict: 2048 },
        }));
    });

    test("validates malformed JSON and schema-invalid structured responses", async () => {
        let response = "not json";
        const providers = createOllamaProviders({
            configuration,
            fetchImplementation: async () => chatResponse(response),
        });
        await expect(providers.topicTagProvider.generateTopicTags("evidence")).rejects.toThrow("malformed JSON");
        response = JSON.stringify([{ name: "missing aliases" }, { name: "second", aliases: [] }, { name: "third", aliases: [] }]);
        await expect(providers.topicTagProvider.generateTopicTags("evidence")).rejects.toThrow("failed validation");
    });

    test("prefixes document and query inputs and persists resolved embedding compatibility", async () => {
        const inputs: string[] = [];
        const vector = Array<number>(768).fill(0);
        vector[0] = 2;
        const providers = createOllamaProviders({
            configuration,
            fetchImplementation: async (url, init) => {
                const path = new URL(String(url)).pathname;
                if (path === "/api/tags") return json({ models: [
                    { name: "gemma3:latest", digest: "generation-digest" },
                    { name: "nomic-embed-text:latest", digest: "embedding-digest" },
                ] });
                if (path === "/api/show") return json({ capabilities: ["embedding"] });
                const body = JSON.parse(String(init?.body)) as { input: string; truncate: boolean; dimensions: number };
                inputs.push(body.input);
                expect(body).toEqual(expect.objectContaining({ truncate: false, dimensions: 768 }));
                return json({ embeddings: [vector] });
            },
        });

        await providers.preflight();
        expect(providers.embeddingProvider.representation).toEqual({
            provider: "ollama",
            model: "nomic-embed-text:latest",
            dimensions: 768,
            metadata: { digest: "embedding-digest", normalization: "unit-length", prefixPolicy: "nomic-search-v1" },
        });
        expect(await providers.embeddingProvider.embed("passage")).toHaveLength(768);
        expect(await providers.embeddingProvider.embedQuery("question")).toHaveLength(768);
        expect(inputs).toEqual(["search_document: passage", "search_query: question"]);
    });

    test("rejects missing models, invalid dimensions, and zero embeddings", async () => {
        const missing = createOllamaProviders({
            configuration,
            fetchImplementation: async () => json({ models: [] }),
        });
        await expect(missing.preflight()).rejects.toThrow("generation model 'gemma3:latest' is not installed");

        const responses = [Array<number>(767).fill(1), Array<number>(768).fill(0)];
        const invalid = createOllamaProviders({
            configuration,
            fetchImplementation: async (url) => {
                const path = new URL(String(url)).pathname;
                if (path === "/api/tags") return json({ models: [
                    { name: "gemma3:latest", digest: "a" },
                    { name: "nomic-embed-text:latest", digest: "b" },
                ] });
                if (path === "/api/show") return json({});
                return json({ embeddings: [responses.shift()] });
            },
        });
        await expect(invalid.embeddingProvider.embed("wrong dimensions")).rejects.toThrow("invalid 768-dimension");
        await expect(invalid.embeddingProvider.embed("zero")).rejects.toThrow("zero or non-finite");
    });

    test("reports oversized input, server errors, and timeouts explicitly", async () => {
        const oversized = createOllamaProviders({ configuration, fetchImplementation: async () => chatResponse("unused") });
        await expect(oversized.summaryProvider.generate("x".repeat(28_001))).rejects.toThrow("maximum is 28000 bytes");

        const failed = createOllamaProviders({ configuration, fetchImplementation: async () => new Response("model runner failed", { status: 500 }) });
        await expect(failed.summaryProvider.generate("short")).rejects.toThrow("HTTP 500: model runner failed");

        const timedOut = createOllamaProviders({
            configuration,
            fetchImplementation: async () => { throw new DOMException("timed out", "TimeoutError"); },
        });
        try {
            await timedOut.summaryProvider.generate("short");
            throw new Error("Expected generation to time out");
        } catch (error) {
            expect(error).toBeInstanceOf(OllamaProviderError);
            expect((error as OllamaProviderError).kind).toBe("timeout");
            expect((error as Error).message).toContain("180000ms");
        }

        const embeddingFailure = createOllamaProviders({
            configuration,
            fetchImplementation: async (url) => {
                const path = new URL(String(url)).pathname;
                if (path === "/api/tags") return json({ models: [
                    { name: "gemma3:latest", digest: "a" },
                    { name: "nomic-embed-text:latest", digest: "b" },
                ] });
                if (path === "/api/show") return json({});
                return new Response("input length exceeds the model context window", { status: 400 });
            },
        });
        await expect(embeddingFailure.embeddingProvider.embed("oversized document")).rejects.toThrow("input length exceeds the model context window");

        const embeddingTimeout = createOllamaProviders({
            configuration,
            fetchImplementation: async (url) => {
                const path = new URL(String(url)).pathname;
                if (path === "/api/tags") return json({ models: [
                    { name: "gemma3:latest", digest: "a" },
                    { name: "nomic-embed-text:latest", digest: "b" },
                ] });
                if (path === "/api/show") return json({});
                throw new DOMException("timed out", "TimeoutError");
            },
        });
        await expect(embeddingTimeout.embeddingProvider.embed("document")).rejects.toThrow("60000ms");
    });
});

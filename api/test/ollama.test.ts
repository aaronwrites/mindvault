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

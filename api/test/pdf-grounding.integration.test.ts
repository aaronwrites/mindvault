import { afterEach, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { createOllamaProviders } from "../src/lib/ai/ollama";
import { DeterministicOriginalFileStorageFake } from "../src/lib/original-files/deterministic-original-file-storage-fake";
import { createArticleProcessingWorker } from "../src/worker";
import { DeterministicEmbeddingProvider, DeterministicTopicTagGenerationProvider } from "./support/deterministic-runtime";
import { createIntegrationHarness, type IntegrationHarness } from "./support/integration-harness";

let harness: IntegrationHarness | undefined;
afterEach(async () => { await harness?.cleanup(); harness = undefined; });

test("rejected PDF summary claims remain a warning while primary evidence stays Ready", async () => {
    const storage = new DeterministicOriginalFileStorageFake();
    const embeddings = new DeterministicEmbeddingProvider();
    const auditTexts: string[] = [];
    const providers = createOllamaProviders({ fetchImplementation: async (_url, init) => {
        const response = { statementIndexes: [999] };
        return new Response(JSON.stringify({ message: { content: JSON.stringify(response) } }), { headers: { "content-type": "application/json" } });
    } });
    harness = await createIntegrationHarness(
        database => createApp({ database: database.db, originalFileStorage: storage, embeddingProvider: embeddings }),
        database => createArticleProcessingWorker({ database: database.db, originalFileStorage: () => storage,
            embeddingProvider: embeddings, summaryProvider: { generate(prompt, grounding) {
                if (grounding) auditTexts.push(grounding.sourceText);
                return providers.summaryProvider.generate(prompt, grounding);
            } },
            topicTagProvider: new DeterministicTopicTagGenerationProvider(), maxAttempts: 1 }),
    );
    const form = new FormData();
    form.set("file", new Blob([await Bun.file(new URL("fixtures/pdf/selectable.pdf", import.meta.url)).arrayBuffer()]), "invented-workflow.pdf");
    form.set("personalNote", "invented-workflow is why I saved this.");
    const captured = await fetch(`${harness.apiBaseUrl}/captures/file`, { method: "POST", body: form });
    expect(captured.status).toBe(201);
    const { knowledgeItemId } = await captured.json() as { knowledgeItemId: number };
    await harness.drainWorker();
    const item = await fetch(`${harness.apiBaseUrl}/knowledge-items/${knowledgeItemId}`).then(response => response.json()) as any;
    expect(auditTexts).toHaveLength(1);
    for (const text of auditTexts) {
        expect(text).toContain("WAL_RECOVERY_TARGET");
        expect(text).not.toContain("invented-workflow");
    }
    expect(item.availability).toBe("ready");
    expect(item.recognitionSummary).toBeNull();
    expect(JSON.stringify(item)).toContain("grounding failed after one correction");
    const recalled = await fetch(`${harness.apiBaseUrl}/search?q=WAL_RECOVERY_TARGET`).then(response => response.json()) as any[];
    expect(recalled).toContainEqual(expect.objectContaining({ id: knowledgeItemId,
        excerpts: expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining("WAL_RECOVERY_TARGET"), pageNumber: 1 })]) }));
}, 20_000);

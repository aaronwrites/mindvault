import { afterEach, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { createOllamaProviders } from "../src/lib/ai/ollama";
import type { KnowledgeItemView } from "../src/lib/knowledge-items/read-knowledge-items";
import { DeterministicOriginalFileStorageFake } from "../src/lib/original-files/deterministic-original-file-storage-fake";
import { createArticleProcessingWorker } from "../src/worker";
import { DeterministicEmbeddingProvider, DeterministicTopicTagGenerationProvider } from "./support/deterministic-runtime";
import { createIntegrationHarness, type IntegrationHarness } from "./support/integration-harness";

let harness: IntegrationHarness | undefined;
afterEach(async () => { await harness?.cleanup(); harness = undefined; });

// Bounded summary quality acceptance. Review actual outputs against the criteria
// in docs/tldr-acceptance.md; string existence alone does not establish quality.
test.skipIf(process.env.RUN_LIVE_TLDR_CHECK !== "1" || !process.env.TEST_DATABASE_URL)("local-model TL;DRs communicate grounded main points across web and PDF evidence", async () => {
    const providers = createOllamaProviders();
    await providers.preflight();
    const embeddings = new DeterministicEmbeddingProvider();
    const storage = new DeterministicOriginalFileStorageFake();
    const outputs: Record<string, unknown> = { models: providers.modelDigests };
    harness = await createIntegrationHarness(
        database => createApp({ database: database.db, originalFileStorage: storage, embeddingProvider: embeddings }),
        (database, server) => createArticleProcessingWorker({ database: database.db, originalFileStorage: () => storage,
            sourceFetchOptions: server.safeFetchDependencies(), embeddingProvider: embeddings,
            summaryProvider: providers.summaryProvider, topicTagProvider: new DeterministicTopicTagGenerationProvider(), maxAttempts: 1 }),
    );
    try {
        for (const [name, path, pdf] of [
            ["web-processing", "/articles/primary-text", false],
            ["web-retention", "/articles/semantic-retention", false],
            ["metadata-preview", "/metadata/description-only", false],
            ["full-pdf", "selectable.pdf", true],
            ["partial-pdf", "mixed.pdf", true],
        ] as const) {
            let response: Response;
            if (pdf) {
                const form = new FormData();
                form.set("file", new Blob([await Bun.file(new URL(`fixtures/pdf/${path}`, import.meta.url)).arrayBuffer()]), path);
                form.set("personalNote", "A flying purple database uses MAGIC_RECOVERY_AUTOMATION. This is my note, not a source claim.");
                response = await fetch(`${harness.apiBaseUrl}/captures/file`, { method: "POST", body: form });
            } else {
                response = await fetch(`${harness.apiBaseUrl}/captures`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: harness.sourceServer.fetchUrl(path) }) });
            }
            expect(response.status).toBe(201);
            const { knowledgeItemId } = await response.json() as { knowledgeItemId: number };
            const started = performance.now();
            await harness.drainWorker();
            const item = await fetch(`${harness.apiBaseUrl}/knowledge-items/${knowledgeItemId}`).then(response => response.json()) as KnowledgeItemView;
            outputs[name] = { processingMs: Math.round(performance.now() - started), item };
            console.log("TLDR_CASE", JSON.stringify({ name, ...outputs[name] as object }));
            expect(item.availability).toBe("ready");
            expect(item.recognitionSummary).toBeString();
            expect(item.recognitionSummaryProvenance).toMatchObject({ contract: name === "metadata-preview" ? "preview-v1" : "tldr-v1", isCurrent: true });
            expect(item.recognitionSummary).not.toContain("MAGIC_RECOVERY_AUTOMATION");
            if (name === "partial-pdf") {
                expect(item.recognitionSummary).toStartWith("From partially extracted PDF text:");
                expect(item.extractionCoverage?.pages.find(page => page.pageNumber === 3)?.outcome).not.toBe("extracted");
            }
        }
    } finally {
        console.log("TLDR_ACCEPTANCE_REPORT", JSON.stringify(outputs, null, 2));
    }
}, 15 * 60_000);

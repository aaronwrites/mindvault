import { afterEach, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { createArticleProcessingWorker } from "../src/worker";
import { DeterministicOriginalFileStorageFake } from "../src/lib/original-files/deterministic-original-file-storage-fake";
import { DeterministicEmbeddingProvider, DeterministicGenerationProvider, DeterministicTopicTagGenerationProvider } from "./support/deterministic-runtime";
import { createIntegrationHarness, type IntegrationHarness } from "./support/integration-harness";

class RecoveryEmbeddingProvider extends DeterministicEmbeddingProvider {
    override async embed(text: string) {
        const vector = Array<number>(this.representation.dimensions).fill(0);
        vector[/recovery|WAL|accidental database change/i.test(text) ? 0 : 1] = 1;
        return vector;
    }
}
let harness: IntegrationHarness | undefined;
afterEach(async () => { await harness?.cleanup(); harness = undefined; });

test("a retained selectable-text PDF becomes Ready with grounded enrichment and physical page Recall", async () => {
    const storage = new DeterministicOriginalFileStorageFake();
    const embeddings = new RecoveryEmbeddingProvider();
    harness = await createIntegrationHarness(
        database => createApp({ database: database.db, originalFileStorage: storage, embeddingProvider: embeddings }),
        (database, sourceServer) => createArticleProcessingWorker({
            database: database.db,
            originalFileStorage: () => storage,
            sourceFetchOptions: sourceServer.safeFetchDependencies(),
            embeddingProvider: embeddings,
            summaryProvider: new DeterministicGenerationProvider("A guide to PostgreSQL recovery and durable transaction logs."),
            topicTagProvider: new DeterministicTopicTagGenerationProvider(),
            maxAttempts: 1,
        }),
    );
    const form = new FormData();
    form.set("file", new Blob([await Bun.file(new URL("fixtures/pdf/selectable.pdf", import.meta.url)).arrayBuffer()]), "recovery.pdf");
    const response = await fetch(`${harness.apiBaseUrl}/captures/file`, { method: "POST", body: form });
    const captured = await response.json() as any;
    expect(response.status).toBe(201);
    expect(captured.availability).toBe("processing");
    expect(captured.processingAttemptId).toBeNumber();
    await harness.drainWorker();
    const item = await (await fetch(`${harness.apiBaseUrl}/knowledge-items/${captured.knowledgeItemId}`)).json() as any;
    expect(item.availability).toBe("ready");
    expect(item.recognitionSummary).toContain("PostgreSQL recovery");
    expect(item.topicTags).toContain("Testing");
    expect(item.source.filename).toBe("recovery.pdf");
    expect(item.source.originalFileActions.open).toBeString();
    expect(item.captureContexts).toEqual([]);
    const recall = await (await fetch(`${harness.apiBaseUrl}/search?q=WAL_RECOVERY_TARGET`)).json() as any;
    expect(recall[0].id).toBe(item.id);
    expect(recall[0].excerpts[0]).toMatchObject({ pageNumber: 1, sourceSnapshot: { originalUrl: null, finalUrl: null } });
    const conceptual = await search("undo an accidental database change");
    expect(conceptual[0].id).toBe(item.id);
    expect(conceptual[0].excerpts.some((excerpt: any) => excerpt.ranking.semanticRank !== undefined)).toBe(true);
    const secondPage = await search("archived WAL");
    expect(secondPage[0].excerpts.find((excerpt: any) => excerpt.ranking.lexicalRank !== undefined).pageNumber).toBe(2);
    expect(item.extractionCoverage.pages[1]).toMatchObject({ pageNumber: 2, pageLabel: "1" });
}, 15_000);

test("an existing retained PDF can be processed explicitly, deduplicates retries, and stays excluded in Trash", async () => {
    const { captured } = await setupPdf("selectable.pdf");
    // Represents a retained PDF captured before this adapter existed.
    await harness!.database.pool.query("DELETE FROM processing_stages");
    await harness!.database.pool.query("DELETE FROM processing_attempts");
    expect((await readItem(captured.knowledgeItemId)).availability).toBe("unsupported");
    const processResponse = await postItem(captured.knowledgeItemId, "refresh");
    expect(processResponse.status).toBe(202);
    await harness!.drainWorker();
    const ready = await readItem(captured.knowledgeItemId);
    expect(ready.availability).toBe("ready");
    expect(ready.extractionCoverage).toMatchObject({ pageCount: 2, pages: [{ pageNumber: 1, outcome: "extracted" }, { pageNumber: 2, outcome: "extracted" }] });
    const first = await search("WAL_RECOVERY_TARGET");
    await postItem(captured.knowledgeItemId, "refresh");
    await harness!.drainWorker();
    const repeated = await search("WAL_RECOVERY_TARGET");
    expect(repeated[0].excerpts).toEqual(first[0].excerpts);
    expect(repeated[0].ranking.matchedPassageCount).toBe(1);
    expect((await harness!.database.pool.query("SELECT count(*)::int AS count FROM source_snapshots")).rows[0].count).toBe(1);
    await postItem(captured.knowledgeItemId, "trash");
    expect(await search("WAL_RECOVERY_TARGET")).toEqual([]);
    expect((await postItem(captured.knowledgeItemId, "refresh")).status).toBe(404);
    await postItem(captured.knowledgeItemId, "restore");
    expect((await search("WAL_RECOVERY_TARGET"))[0].id).toBe(captured.knowledgeItemId);
}, 15_000);

async function setupPdf(fixture: string, limits?: Partial<import("../src/lib/pdf/extract-pdf").PdfProcessingLimits>) {
    const storage = new DeterministicOriginalFileStorageFake();
    const embeddings = new DeterministicEmbeddingProvider();
    const { pdfProcessingLimits } = await import("../src/lib/pdf/extract-pdf");
    const pdfLimits = { ...pdfProcessingLimits({}), ...limits };
    harness = await createIntegrationHarness(
        database => createApp({ database: database.db, originalFileStorage: storage, embeddingProvider: embeddings }),
        database => createArticleProcessingWorker({ database: database.db, originalFileStorage: () => storage, pdfLimits, embeddingProvider: embeddings,
            summaryProvider: new DeterministicGenerationProvider("A recovery guide."), topicTagProvider: new DeterministicTopicTagGenerationProvider(), maxAttempts: 1 }),
    );
    const form = new FormData();
    form.set("file", new Blob([await Bun.file(new URL(`fixtures/pdf/${fixture}`, import.meta.url)).arrayBuffer()]), fixture);
    const response = await fetch(`${harness.apiBaseUrl}/captures/file`, { method: "POST", body: form });
    expect(response.status).toBe(201);
    return { captured: await response.json() as any, storage, pdfLimits };
}
async function readItem(id: number) { return (await fetch(`${harness!.apiBaseUrl}/knowledge-items/${id}`)).json() as Promise<any>; }
async function postItem(id: number, action: string) { return fetch(`${harness!.apiBaseUrl}/knowledge-items/${id}/${action}`, { method: "POST" }); }
async function search(query: string) { return (await fetch(`${harness!.apiBaseUrl}/search?q=${encodeURIComponent(query)}`)).json() as Promise<any[]>; }

for (const [fixture, reason] of [["malformed.pdf", "malformed"], ["encrypted.pdf", "encrypted"], ["empty.pdf", "no trustworthy selectable text"]] as const) {
    test(`retains ${fixture} with an actionable reason and no invented evidence`, async () => {
        const { captured, storage } = await setupPdf(fixture);
        await harness!.drainWorker();
        const item = await readItem(captured.knowledgeItemId);
        expect(item.availability).toBe("needs-attention");
        expect(item.latestAttempt.failureReason).toContain(reason);
        expect(item.recognitionSummary).toBeNull();
        expect(item.source.originalFileActions.download).toBeString();
        expect(storage.uploadedFileCount).toBe(1);
        expect(await search("recovery")).toEqual([]);
    });
}
for (const [limits, reason] of [[{ maximumPages: 1 }, "page limit"], [{ maximumBytes: 100 }, "byte limit"], [{ maximumCharacters: 50 }, "text limit"], [{ timeoutMs: 1 }, "time or memory limit"], [{ heapMiB: 8 }, "memory/output limit"]] as const) {
    test(`processing limits (${reason}) fail explicitly without hidden truncation`, async () => {
        const { captured } = await setupPdf("selectable.pdf", limits);
        await harness!.drainWorker();
        const item = await readItem(captured.knowledgeItemId);
        expect(item.availability).toBe("needs-attention");
        expect(item.latestAttempt.failureReason).toContain(reason);
        expect(item.source.originalFileActions.open).toBeString();
        expect(await search("recovery")).toEqual([]);
    });
}

test("storage failures retry successfully and later failures retain Ready evidence", async () => {
    const { captured, storage, pdfLimits } = await setupPdf("selectable.pdf");
    storage.setOutage(true);
    await harness!.drainWorker();
    expect((await readItem(captured.knowledgeItemId)).latestAttempt.failureReason).toContain("storage is unavailable");
    storage.setOutage(false);
    expect((await postItem(captured.knowledgeItemId, "retry")).status).toBe(202);
    await harness!.drainWorker();
    expect((await readItem(captured.knowledgeItemId)).availability).toBe("ready");
    pdfLimits.maximumCharacters = 50;
    await postItem(captured.knowledgeItemId, "refresh");
    await harness!.drainWorker();
    const ready = await readItem(captured.knowledgeItemId);
    expect(ready.availability).toBe("ready");
    expect(ready.latestAttempt.failureReason).toContain("text limit");
    expect((await search("WAL_RECOVERY_TARGET"))[0].id).toBe(captured.knowledgeItemId);
});

test("native evidence preserves distinct gaps and blank pages", async () => {
    const { captured } = await setupPdf("partial-native.pdf");
    await harness!.drainWorker();
    const item = await readItem(captured.knowledgeItemId);
    expect(item.availability).toBe("ready");
    expect(item.extractionCoverage).toMatchObject({ pageCount: 3, pages: [
        { pageNumber: 1, method: "native", outcome: "extracted" },
        { pageNumber: 2, method: "none", outcome: "needs-ocr" },
        { pageNumber: 3, method: "none", outcome: "blank" },
    ] });
});

test("a PDF beyond the generation budget stays searchable and discloses failed enrichment", async () => {
    const { captured } = await setupPdf("generation-limit.pdf");
    await harness!.drainWorker();
    const item = await readItem(captured.knowledgeItemId);
    expect(item.availability).toBe("ready");
    expect(item.organizationCondition).toBe("incomplete");
    expect(item.recognitionSummary).toBeNull();
    expect(item.latestAttempt.warnings).toContain("PDF evidence exceeds the generation input limit; whole-document enrichment was not generated");
    expect((await search("WAL_RECOVERY_TARGET"))[0].id).toBe(captured.knowledgeItemId);
});

test("native PDF Recall follows physical line order rather than drawing order", async () => {
    const { captured } = await setupPdf("reading-order.pdf");
    await harness!.drainWorker();
    expect((await readItem(captured.knowledgeItemId)).availability).toBe("ready");
    const results = await search("base backup");
    expect(results[0].excerpts[0].text).toBe("First: restore the base backup before replaying any transaction logs.\nSecond: replay archived WAL to recover committed transactions.");
    expect(results[0].excerpts[0].pageNumber).toBe(1);
});

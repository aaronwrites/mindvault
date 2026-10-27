import { afterEach, expect, test } from "bun:test";
import { GenerationInputLimitError } from "../src/lib/ai/providers";
import { createApp } from "../src/app";
import { createArticleProcessingWorker } from "../src/worker";
import type { SynthesisGenerationInput, SynthesisGenerationProvider } from "../src/lib/ai/providers";
import { DeterministicOriginalFileStorageFake } from "../src/lib/original-files/deterministic-original-file-storage-fake";
import { DeterministicEmbeddingProvider, DeterministicGenerationProvider, DeterministicTopicTagGenerationProvider } from "./support/deterministic-runtime";
import { createIntegrationHarness, type IntegrationHarness } from "./support/integration-harness";
let harness: IntegrationHarness | undefined;
afterEach(async () => { await harness?.cleanup(); harness = undefined; });
test("PDF citations preserve physical pages and fresh mixed evidence through follow-ups", async () => {
    const storage = new DeterministicOriginalFileStorageFake();
    const embeddings = new class extends DeterministicEmbeddingProvider {
        override async embed() { return [1, ...Array<number>(767).fill(0)]; }
    }();
    const inputs: SynthesisGenerationInput[] = [];
    let insufficient = false;
    let invalid = false;
    let inputLimit = false;
    const synthesisProvider: SynthesisGenerationProvider = {
        async resolveQuestion() { return "archived WAL"; },
        async generateSynthesis(input) {
            inputs.push(input);
            if (inputLimit) throw new GenerationInputLimitError("Generation input exceeds the supported limit");
            return { answer: insufficient ? "Extracted text does not establish the diagram relationship." : "Captured recovery evidence.",
                citationIds: insufficient ? [] : invalid ? ["invented-page"] : input.evidence.map(e => e.citationId), insufficientEvidence: insufficient };
        },
    };
    harness = await createIntegrationHarness(
        database => createApp({ database: database.db, originalFileStorage: storage, embeddingProvider: embeddings, synthesisProvider }),
        (database, server) => createArticleProcessingWorker({ database: database.db, originalFileStorage: () => storage,
            sourceFetchOptions: server.safeFetchDependencies(), embeddingProvider: embeddings,
            summaryProvider: new DeterministicGenerationProvider(), topicTagProvider: new DeterministicTopicTagGenerationProvider() }),
    );
    const form = new FormData();
    form.set("file", new Blob([await Bun.file(new URL("fixtures/pdf/selectable.pdf", import.meta.url)).arrayBuffer()]), "recovery.pdf");
    const captured = await (await fetch(`${harness.apiBaseUrl}/captures/file`, { method: "POST", body: form })).json() as any;
    await fetch(`${harness.apiBaseUrl}/captures`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: harness.sourceServer.fetchUrl("/articles/semantic-retention") }) });
    const mixedForm = new FormData();
    mixedForm.set("file", new Blob([await Bun.file(new URL("fixtures/pdf/mixed.pdf", import.meta.url)).arrayBuffer()]), "mixed.pdf");
    const mixed = await (await fetch(`${harness.apiBaseUrl}/captures/file`, { method: "POST", body: mixedForm })).json() as any;
    await harness.drainWorker();
    const ask = (question: string, conversation: Array<{ question: string; answer: string }> = []) => fetch(`${harness!.apiBaseUrl}/synthesis`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, conversation }),
    });
    const response = await ask("archived WAL");
    expect(response.status).toBe(200);
    const result = await response.json() as any;
    expect(result.answer).toContain("Incomplete PDF extraction");
    expect(result.answer).toContain("physical pages 3");
    const citation = result.citations.find((c: any) => c.knowledgeItemId === captured.knowledgeItemId && c.pageNumber === 2);
    expect(citation).toMatchObject({ pageNumber: 2, pageLabel: "1", originalUrl: null, sourceSnapshotId: expect.any(Number),
        extractionCoverage: { pageCount: 2 }, excerpt: expect.stringContaining("archived WAL"),
        openOriginalFile: `/knowledge-items/${captured.knowledgeItemId}/original-file/open?page=2` });
    expect(inputs[0]?.evidence).toContainEqual(expect.objectContaining({ pageNumber: 2, pageLabel: "1", text: citation.excerpt }));
    expect(result.citations.some((c: any) => c.originalUrl?.startsWith("http"))).toBe(true);
    const ocrCitation = result.citations.find((c: any) => c.knowledgeItemId === mixed.knowledgeItemId && c.pageNumber === 2);
    expect(ocrCitation).toMatchObject({ excerpt: expect.stringContaining("SCAN_RECOVERY_MARKER"), extractionCoverage: { pageCount: 4 } });
    expect(ocrCitation.extractionCoverage.pages[2]).toMatchObject({ pageNumber: 3, outcome: "unreadable" });
    expect(inputs[0]?.evidence).toContainEqual(expect.objectContaining({ knowledgeItemId: mixed.knowledgeItemId, pageNumber: 2,
        extractionCoverage: ocrCitation.extractionCoverage, text: ocrCitation.excerpt }));
    const opened = await fetch(`${harness.apiBaseUrl}${citation.openOriginalFile}`, { redirect: "manual" });
    expect(opened.status).toBe(302);
    expect(new URL(opened.headers.get("location")!).hash).toBe("#page=2");
    expect(storage.canAccess(opened.headers.get("location")!)).toBe(true);
    for (const page of ["0", "-1", "2.5", "abc"]) expect((await fetch(`${harness.apiBaseUrl}/knowledge-items/${captured.knowledgeItemId}/original-file/open?page=${page}`, { redirect: "manual" })).status).toBe(400);
    const history = [{ question: "archived WAL", answer: result.answer }];
    expect((await (await ask("What does it preserve?", history)).json() as any).citations).toContainEqual(expect.objectContaining({ pageNumber: 2 }));
    insufficient = true;
    expect(await (await ask("What relationship does the diagram show?", history)).json()).toMatchObject({ insufficientEvidence: true, citations: [] });
    insufficient = false;
    invalid = true;
    expect((await ask("archived WAL")).status).toBe(502);
    invalid = false;
    inputLimit = true;
    const limited = await ask("archived WAL");
    expect(limited.status).toBe(422);
    expect(await limited.json()).toMatchObject({ error: expect.stringContaining("input limit") });
    inputLimit = false;
    expect((await ask("archived WAL")).status).toBe(200);
    await fetch(`${harness.apiBaseUrl}/knowledge-items/${captured.knowledgeItemId}/trash`, { method: "POST" });
    const afterTrash = await (await ask("What does it preserve?", history)).json() as any;
    expect(afterTrash.citations.some((c: any) => c.knowledgeItemId === captured.knowledgeItemId)).toBe(false);
    expect(inputs.at(-1)?.evidence.some(e => e.knowledgeItemId === captured.knowledgeItemId)).toBe(false);
}, 20_000);

test("large PDF coverage returns a recoverable limit instead of claiming no evidence on follow-ups", async () => {
    const storage = new DeterministicOriginalFileStorageFake();
    const embeddings = new DeterministicEmbeddingProvider();
    const { pdfProcessingLimits } = await import("../src/lib/pdf/extract-pdf");
    let generations = 0;
    const synthesisProvider: SynthesisGenerationProvider = {
        async resolveQuestion() { return "archived WAL"; },
        async generateSynthesis(input) { generations++; return { answer: "Restore the base backup.", citationIds: input.evidence.map(e => e.citationId), insufficientEvidence: false }; },
    };
    harness = await createIntegrationHarness(
        database => createApp({ database: database.db, originalFileStorage: storage, embeddingProvider: embeddings, synthesisProvider }),
        database => createArticleProcessingWorker({ database: database.db, originalFileStorage: () => storage, embeddingProvider: embeddings,
            pdfLimits: { ...pdfProcessingLimits({}), maximumOcrPages: 1 },
            summaryProvider: new DeterministicGenerationProvider(), topicTagProvider: new DeterministicTopicTagGenerationProvider() }),
    );
    const form = new FormData();
    form.set("file", new Blob([await Bun.file(new URL("fixtures/pdf/coverage-limit.pdf", import.meta.url)).arrayBuffer()]), "coverage-limit.pdf");
    expect((await fetch(`${harness.apiBaseUrl}/captures/file`, { method: "POST", body: form })).status).toBe(201);
    await harness.drainWorker();
    const recalled = await (await fetch(`${harness.apiBaseUrl}/search?q=archived%20WAL`)).json() as any;
    expect(recalled[0].excerpts[0]).toMatchObject({ pageNumber: 1, sourceSnapshot: { extractionCoverage: { pageCount: 200 } } });
    const response = await fetch(`${harness.apiBaseUrl}/synthesis`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        question: "What does it preserve?", conversation: [{ question: "Earlier question. ".repeat(100), answer: "Earlier answer. ".repeat(100) }],
    }) });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("input limit") });
    expect(generations).toBe(0);
}, 20_000);

test("follow-ups preserve requested evidence when conversational resolution loses the SQL intent", async () => {
    const storage = new DeterministicOriginalFileStorageFake();
    const question = "What SQL statement appears in its recovery procedure?";
    const vector = (index: number) => Array.from({ length: 768 }, (_, i) => i === index ? 1 : 0);
    const embeddings = new class extends DeterministicEmbeddingProvider {
        override async embed(text: string) { return vector(text.includes("SELECT pg_switch_wal();") ? 1 : 0); }
        override async embedQuery(text: string) { return vector(text === question ? 1 : 0); }
    }();
    const inputs: SynthesisGenerationInput[] = [];
    harness = await createIntegrationHarness(
        database => createApp({ database: database.db, originalFileStorage: storage, embeddingProvider: embeddings,
            synthesisProvider: {
                async resolveQuestion() { return "PostgreSQL base backup recovery guide"; },
                async generateSynthesis(input) {
                    inputs.push(input);
                    return { answer: "Obtained recovery evidence.", citationIds: input.evidence.map(e => e.citationId), insufficientEvidence: false };
                },
            } }),
        database => createArticleProcessingWorker({ database: database.db, originalFileStorage: () => storage, embeddingProvider: embeddings,
            summaryProvider: new DeterministicGenerationProvider(), topicTagProvider: new DeterministicTopicTagGenerationProvider() }),
    );
    const form = new FormData();
    form.set("file", new Blob([await Bun.file(new URL("fixtures/pdf/selectable.pdf", import.meta.url)).arrayBuffer()]), "recovery.pdf");
    const captured = await (await fetch(`${harness.apiBaseUrl}/captures/file`, { method: "POST", body: form })).json() as { knowledgeItemId: number };
    await harness.drainWorker();
    const ask = () => fetch(`${harness!.apiBaseUrl}/synthesis`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question,
            conversation: [{ question: "How does the captured PostgreSQL guide use base backups and archived WAL?", answer: "Restore a base backup and replay WAL." }],
        }),
    });
    const response = await ask();
    expect(response.status).toBe(200);
    const result = await response.json() as any;
    expect(result.citations).toContainEqual(expect.objectContaining({ pageNumber: 2, pageLabel: "1", excerpt: expect.stringContaining("SELECT pg_switch_wal();") }));
    expect(inputs[0]?.evidence).toContainEqual(expect.objectContaining({ pageNumber: 1 }));
    expect(new Set(inputs[0]!.evidence.map(e => e.citationId)).size).toBe(inputs[0]!.evidence.length);
    expect(new Set(inputs[0]!.evidence.map(e => e.text)).size).toBe(inputs[0]!.evidence.length);
    await fetch(`${harness.apiBaseUrl}/knowledge-items/${captured.knowledgeItemId}/trash`, { method: "POST" });
    expect(await (await ask()).json()).toMatchObject({ insufficientEvidence: true, citations: [] });
}, 20_000);

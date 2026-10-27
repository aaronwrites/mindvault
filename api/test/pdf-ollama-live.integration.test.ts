import { afterEach, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { createOllamaProviders } from "../src/lib/ai/ollama";
import type { SynthesisGenerationInput } from "../src/lib/ai/providers";
import { DeterministicOriginalFileStorageFake } from "../src/lib/original-files/deterministic-original-file-storage-fake";
import { createArticleProcessingWorker } from "../src/worker";
import { createIntegrationHarness, type IntegrationHarness } from "./support/integration-harness";

type Capture = { knowledgeItemId: number };
type Item = { availability: string; recognitionSummary: string; topicTags: string[]; captureContexts: unknown[] };
type Citation = { knowledgeItemId: number; pageNumber?: number; excerpt: string };
type Answer = { answer: string; citations: Citation[]; insufficientEvidence: boolean };
type Recall = { id: number; excerpts: Array<{ pageNumber: number; pageLabel: string }> };

let harness: IntegrationHarness | undefined;
afterEach(async () => { await harness?.cleanup(); harness = undefined; });

// This is a repeatable quality assessment, not an assertion of universal model factuality.
// Review the emitted summaries, tags, excerpts and answers against fixtures/pdf/generate.py.
test.skipIf(process.env.RUN_LIVE_PDF_CHECK !== "1" || !process.env.TEST_DATABASE_URL)("live PDF evidence supports grounded local-model Recall and Synthesis", async () => {
    // Retain actual candidate/evidence/audit decisions for inspection. This is
    // fixture-only data; no application captures or signed storage URLs enter it.
    const groundingAssessments: Array<{ request: unknown; response: unknown }> = [];
    const summarySelections: Array<{ request: unknown; response: unknown }> = [];
    const synthesisCandidates: Array<{ request: unknown; response: unknown }> = [];
    const providers = createOllamaProviders({ fetchImplementation: async (url, init) => {
        const response = await fetch(url, init);
        if (new URL(String(url)).pathname === "/api/chat" && init?.body) {
            const body = JSON.parse(String(init.body));
            const trace = body.format?.properties?.supported ? groundingAssessments
                : body.format?.properties?.statementIndexes ? summarySelections
                : body.format?.properties?.answer ? synthesisCandidates : undefined;
            if (trace) trace.push({ request: body.messages, response: await response.clone().json() });
        }
        return response;
    } });
    await providers.preflight();
    const storage = new DeterministicOriginalFileStorageFake();
    const generationInputs: SynthesisGenerationInput[] = [];
    const resolvedQuestions: Array<{ question: string; resolved: string }> = [];
    const answers: Array<{ name: string; output: Answer }> = [];
    const records: Record<string, unknown> = { models: providers.modelDigests, generationInputs, resolvedQuestions, groundingAssessments, summarySelections, synthesisCandidates };
    harness = await createIntegrationHarness(
        database => createApp({ database: database.db, originalFileStorage: storage,
            embeddingProvider: providers.embeddingProvider, synthesisProvider: {
                resolveQuestion: async input => {
                    const resolved = await providers.synthesisProvider.resolveQuestion(input);
                    resolvedQuestions.push({ question: input.question, resolved });
                    return resolved;
                },
                generateSynthesis: input => {
                    generationInputs.push(input);
                    return providers.synthesisProvider.generateSynthesis(input);
                },
            } }),
        (database, server) => createArticleProcessingWorker({ database: database.db, originalFileStorage: () => storage,
            sourceFetchOptions: server.safeFetchDependencies(), embeddingProvider: providers.embeddingProvider,
            summaryProvider: providers.summaryProvider, topicTagProvider: providers.topicTagProvider, retryBaseDelayMs: 1, retryMaxDelayMs: 1 }),
    );
    const request = async <T,>(path: string, status = 200, init?: RequestInit) => {
        const response = await fetch(`${harness!.apiBaseUrl}${path}`, init);
        const body = response.status === 204 ? null : await response.json();
        expect(response.status, JSON.stringify(body)).toBe(status);
        return body as T;
    };
    const post = <T,>(path: string, body?: unknown, status = 200) => request<T>(path, status, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const capture = async (fixture: string) => {
        const form = new FormData();
        form.set("file", new Blob([await Bun.file(new URL(`fixtures/pdf/${fixture}`, import.meta.url)).arrayBuffer()]), fixture);
        return request<Capture>("/captures/file", 201, { method: "POST", body: form });
    };
    const recall = (query: string) => request<Recall[]>(`/search?q=${encodeURIComponent(query)}`);
    const ask = async (name: string, question: string, conversation: Array<{ question: string; answer: string }> = []) => {
        const answer = await post<Answer>("/synthesis", { question, conversation });
        records[name] = { question, ...answer };
        answers.push({ name, output: answer });
        console.log(JSON.stringify({ [name]: records[name] }, null, 2));
        return answer;
    };
    try {
        // Arrange a pre-adapter retained PDF before running any worker. This mirrors the
        // existing retained-file regression; assertions still use the public HTTP boundary.
        const retained = await capture("selectable.pdf");
        await harness.database.pool.query("DELETE FROM processing_stages");
        await harness.database.pool.query("DELETE FROM processing_attempts");
        expect((await request<Item>(`/knowledge-items/${retained.knowledgeItemId}`)).availability).toBe("unsupported");
        await post(`/knowledge-items/${retained.knowledgeItemId}/refresh`, undefined, 202);
        const scan = await capture("printed-scan.pdf");
        const mixed = await capture("mixed.pdf");
        const web = await post<Capture>("/captures", { url: harness.sourceServer.fetchUrl("/articles/semantic-retention") }, 201);
        const started = performance.now();
        await harness.drainWorker();
        records.processingMs = Math.round(performance.now() - started);
        records.uploadedFileCount = storage.uploadedFileCount;
        expect(storage.uploadedFileCount).toBe(3);
        for (const [name, captured, marker, page] of [
            ["retainedSelectable", retained, "WAL_RECOVERY_TARGET", 1],
            ["printedScan", scan, "SCAN_RECOVERY_MARKER", 1],
            ["mixed", mixed, "SCAN_RECOVERY_MARKER", 2],
        ] as const) {
            const item = await request<Item>(`/knowledge-items/${captured.knowledgeItemId}`);
            const exact = await recall(marker);
            const conceptual = await recall("How can I return a database to an earlier state using its saved transaction history?");
            records[name] = { item, exact, conceptual };
            console.log(JSON.stringify({ [name]: records[name] }, null, 2));
            expect(item.availability).toBe("ready");
            expect(item.recognitionSummary).toBeString();
            expect(item.recognitionSummary.length).toBeGreaterThan(0);
            expect(item.topicTags.length).toBeGreaterThan(0);
            expect(item.captureContexts).toEqual([]);
            expect(exact).toContainEqual(expect.objectContaining({ id: captured.knowledgeItemId,
                excerpts: expect.arrayContaining([expect.objectContaining({ pageNumber: page, text: expect.stringContaining(marker) })]) }));
            expect(conceptual).toContainEqual(expect.objectContaining({ id: captured.knowledgeItemId }));
            // Isolate each PDF through Trash so each format must independently support
            // an answer and follow-up, rather than borrowing another document's evidence.
            const others = [retained, scan, mixed, web].filter(other => other.knowledgeItemId !== captured.knowledgeItemId);
            for (const other of others) await post(`/knowledge-items/${other.knowledgeItemId}/trash`, undefined, 204);
            const question = "How does the captured PostgreSQL guide use base backups and archived WAL for recovery?";
            const answer = await ask(`${name}Answer`, question);
            expect(answer.insufficientEvidence).toBe(false);
            expect(answer.citations.length).toBeGreaterThan(0);
            expect(answer.citations.every(citation => citation.knowledgeItemId === captured.knowledgeItemId)).toBe(true);
            if (name === "mixed") {
                expect(item.recognitionSummary).toMatch(/partial|incomplete/iu);
                expect(answer.answer).toMatch(/extract|unread|incomplete/iu);
                expect(answer.answer).toContain("3");
            }
            const followUp = await ask(`${name}FollowUp`, "What SQL statement appears in its PostgreSQL recovery procedure?", [{ question, answer: answer.answer }]);
            expect(followUp.insufficientEvidence).toBe(false);
            expect(followUp.answer).toContain("SELECT pg_switch_wal();");
            expect(followUp.citations.length).toBeGreaterThan(0);
            expect(followUp.citations.every(citation => citation.knowledgeItemId === captured.knowledgeItemId)).toBe(true);
            for (const other of others) await post(`/knowledge-items/${other.knowledgeItemId}/restore`);
            for (const [action, disposition] of [["open", "inline"], ["download", "attachment"]] as const) {
                const response = await fetch(`${harness.apiBaseUrl}/knowledge-items/${captured.knowledgeItemId}/original-file/${action}`, { redirect: "manual" });
                expect(response.status).toBe(302);
                const location = response.headers.get("location")!;
                expect(storage.canAccess(location)).toBe(true);
                expect(new URL(location).searchParams.get("disposition")).toBe(disposition);
                const unsigned = new URL(location);
                unsigned.searchParams.delete("signature");
                expect(storage.canAccess(unsigned.toString())).toBe(false);
            }
        }
        const pages = await recall("archived WAL");
        const numbered = pages.find((item: { id: number }) => item.id === retained.knowledgeItemId);
        expect(numbered).toBeDefined();
        const pageTwo = numbered!.excerpts.find((excerpt: { pageNumber: number }) => excerpt.pageNumber === 2);
        expect(pageTwo!.pageLabel).toBe("1");
        const opened = await fetch(`${harness.apiBaseUrl}/knowledge-items/${retained.knowledgeItemId}/original-file/open?page=2`, { redirect: "manual" });
        expect(opened.status).toBe(302);
        expect(new URL(opened.headers.get("location")!).hash).toBe("#page=2");
        records.pageTarget = { physicalPage: 2, printedLabel: pageTwo!.pageLabel, status: opened.status, fragment: "#page=2" };
        const collection = await ask("collectionAnswer", "How do the captured guides preserve database recovery knowledge with WAL, and how does MindVault preserve article text when a website disappears?");
        expect(collection.insufficientEvidence).toBe(false);
        expect(collection.citations.some((citation: { knowledgeItemId: number }) => citation.knowledgeItemId === web.knowledgeItemId)).toBe(true);
        expect(collection.citations.some((citation: { pageNumber?: number }) => citation.pageNumber)).toBe(true);
        const visual = await ask("unsupportedVisual", "In the captured PostgreSQL WAL recovery PDF, what relationship does the diagram on physical page 3 show between its shapes?");
        expect(visual).toMatchObject({ insufficientEvidence: true, citations: [] });
        const noEvidence = await capture("no-evidence.pdf");
        await harness.drainWorker();
        const unreadable = await request<Item & { latestAttempt: { failureReason: string } }>(`/knowledge-items/${noEvidence.knowledgeItemId}`);
        records.noEvidence = unreadable;
        expect(unreadable.availability).toBe("needs-attention");
        expect(unreadable.recognitionSummary).toBeNull();
        expect(unreadable.latestAttempt.failureReason).toContain("no trustworthy selectable text or printed English OCR evidence");
        // Exact technical identifiers are inspectable facts. A fluent answer must not
        // combine two supplied names into a new one, even when its citation IDs resolve.
        // Natural-language factuality (including summaries) still needs manual review.
        for (const { name, output } of answers) {
            const citedText = output.citations.map(citation => citation.excerpt).join("\n");
            for (const identifier of output.answer.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/gu) ?? []) {
                expect(citedText, `${name}: ${identifier} must occur in cited evidence`).toContain(identifier);
            }
        }
    } finally {
        console.log("PDF_ACCEPTANCE_REPORT", JSON.stringify(records, null, 2));
    }
}, 20 * 60_000);

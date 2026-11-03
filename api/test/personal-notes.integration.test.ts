import { afterEach, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { createArticleProcessingWorker } from "../src/worker";
import { DeterministicEmbeddingProvider, DeterministicGenerationProvider, DeterministicTopicTagGenerationProvider } from "./support/deterministic-runtime";
import { createIntegrationHarness, type IntegrationHarness } from "./support/integration-harness";

type Context = { id: number; kind: string; text: string; summary: string };
let harness: IntegrationHarness | undefined;
afterEach(async () => { await harness?.cleanup(); harness = undefined; });

test.skipIf(!process.env.TEST_DATABASE_URL)("maintains full independent Personal Notes and invalidates obsolete Recall and Synthesis evidence", async () => {
    const embeddingProvider = new DeterministicEmbeddingProvider();
    const evidenceTexts: string[] = [];
    harness = await createIntegrationHarness(
        database => createApp({ database: database.db, embeddingProvider, synthesisProvider: {
            async resolveQuestion({ question }) { return question; },
            async generateSynthesis({ evidence }) {
                evidenceTexts.push(JSON.stringify(evidence));
                return { answer: "Grounded answer.", citationIds: evidence.map(item => item.citationId), insufficientEvidence: false };
            },
        } }),
        (database, sourceServer) => createArticleProcessingWorker({ database: database.db, clock: { now: () => new Date(Date.now() + 60000) }, maxAttempts: 1, sourceFetchOptions: sourceServer.safeFetchDependencies(), embeddingProvider, summaryProvider: new DeterministicGenerationProvider(), topicTagProvider: new DeterministicTopicTagGenerationProvider() }),
    );
    const request = (path: string, method = "GET", body?: unknown) => fetch(`${harness!.apiBaseUrl}${path}`, {
        method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    const fullNote = "Old quasar memory.\n" + "Keep this full paragraph. ".repeat(30).trimEnd();
    const capture = await (await request("/captures", "POST", { url: harness.sourceServer.fetchUrl("/articles/changed"), personalNote: fullNote, selectedText: "Source selection must stay unchanged." })).json() as { knowledgeItemId: number };
    const path = `/knowledge-items/${capture.knowledgeItemId}`;
    const contexts = async () => ((await (await request(path)).json()) as { captureContexts: Context[] }).captureContexts;
    const initial = await contexts();
    const note = initial.find(context => context.kind === "personal-note")!;
    const selection = initial.find(context => context.kind === "selected-source-text")!;
    expect(note).toEqual(expect.objectContaining({ id: expect.any(Number), text: fullNote }));
    await request("/captures", "POST", { url: harness.sourceServer.fetchUrl("/articles/changed"), personalNote: "A later Capture’s separate note." });
    const later = (await contexts()).find(context => context.text === "A later Capture’s separate note.")!;
    expect(later.id).not.toBe(note.id);
    await harness.drainWorker();
    expect(await (await request(path)).json()).toEqual(expect.objectContaining({ availability: "ready" }));
    expect(JSON.stringify(await (await request("/search?q=quasar")).json())).toContain("Old quasar memory");
    await request("/synthesis", "POST", { question: "quasar" });
    expect(evidenceTexts.join(" ")).toContain("Old quasar memory");
    expect(evidenceTexts.join(" ")).toContain('"origin":"personal-note"');
    evidenceTexts.length = 0;
    expect((await request(`${path}/notes`, "POST", { text: "Independent second note." })).status).toBe(200);
    const second = (await contexts()).find(context => context.text === "Independent second note.")!;
    expect(second.id).not.toBe(note.id);
    expect((await request(`${path}/notes/${note.id}`, "PATCH", { text: "New pulsar memory." })).status).toBe(200);
    expect(await contexts()).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: note.id, text: "New pulsar memory." }),
        expect.objectContaining({ id: second.id, text: "Independent second note." }),
        expect.objectContaining({ id: selection.id, text: "Source selection must stay unchanged." }),
    ]));
    expect(JSON.stringify(await (await request("/search?q=quasar")).json())).not.toContain("Old quasar memory");
    await request("/synthesis", "POST", { question: "quasar" });
    expect(evidenceTexts.join(" ")).not.toContain("Old quasar memory");
    expect((await request(`${path}/notes/${selection.id}`, "PATCH", { text: "Overwrite source" })).status).toBe(404);
    expect((await request(`${path}/notes/${selection.id}`, "DELETE")).status).toBe(404);
    for (const body of [{ text: " " }, { text: 2 }, {}, { text: "bad\u0000text" }, { text: "x".repeat(50001) }]) {
        expect((await request(`${path}/notes/${note.id}`, "PATCH", body)).status).toBe(400);
    }
    await harness.drainWorker();
    expect(JSON.stringify(await (await request("/search?q=pulsar")).json())).toContain("New pulsar memory");
    expect((await request(`${path}/notes/${note.id}`, "DELETE")).status).toBe(200);
    expect(JSON.stringify(await (await request("/search?q=pulsar")).json())).not.toContain("New pulsar memory");
    await request(`${path}/refresh`, "POST");
    await harness.drainWorker();
    expect(await contexts()).toEqual([
        expect.objectContaining({ id: selection.id, text: "Source selection must stay unchanged." }),
        expect.objectContaining({ id: later.id, text: "A later Capture’s separate note." }),
        expect.objectContaining({ id: second.id, text: "Independent second note." }),
    ]);
    evidenceTexts.length = 0;
    await request("/synthesis", "POST", { question: "pulsar" });
    expect(evidenceTexts.join(" ")).not.toContain("New pulsar memory");
    await request(`${path}/trash`, "POST");
    expect((await request(`${path}/notes`, "POST", { text: "Unavailable" })).status).toBe(404);
}, 20000);

test.skipIf(!process.env.TEST_DATABASE_URL)("note edits and removals remain authoritative while semantic processing is in flight", async () => {
    const provider = new DeterministicEmbeddingProvider();
    let blockedText: string | undefined;
    let entered: (() => void) | undefined;
    let release: (() => void) | undefined;
    let gate: Promise<void>;
    const embeddingProvider = {
        representation: provider.representation,
        embedQuery: (text: string) => provider.embedQuery(text),
        async embed(text: string) {
            if (text === blockedText) { blockedText = undefined; entered?.(); await gate; }
            return provider.embed(text);
        },
    };
    harness = await createIntegrationHarness(
        database => createApp({ database: database.db, embeddingProvider }),
        (database, sourceServer) => createArticleProcessingWorker({ database: database.db, clock: { now: () => new Date(Date.now() + 60000) }, maxAttempts: 1, sourceFetchOptions: sourceServer.safeFetchDependencies(), embeddingProvider, summaryProvider: new DeterministicGenerationProvider(), topicTagProvider: new DeterministicTopicTagGenerationProvider() }),
    );
    const request = (path: string, method = "GET", body?: unknown) => fetch(`${harness!.apiBaseUrl}${path}`, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
    const capture = await (await request("/captures", "POST", { url: harness.sourceServer.fetchUrl("/articles/changed"), personalNote: "Before processing." })).json() as { knowledgeItemId: number };
    const path = `/knowledge-items/${capture.knowledgeItemId}`;
    const contexts = async () => ((await (await request(path)).json()) as { captureContexts: Context[] }).captureContexts;
    const [note] = await contexts();
    // An edit before the initial attempt starts is picked up by that attempt too.
    expect((await request(`${path}/notes/${note!.id}`, "PATCH", { text: "First nebula memory." })).status).toBe(200);
    await harness.drainWorker();
    for (const action of ["edit", "remove"] as const) {
        const text = action === "edit" ? "Blocked nebula memory." : "Blocked comet memory.";
        await request(`${path}/notes/${note!.id}`, "PATCH", { text });
        blockedText = text;
        const started = new Promise<void>(resolve => { entered = resolve; });
        gate = new Promise<void>(resolve => { release = resolve; });
        const processing = harness.drainWorker();
        try {
            await started;
            const response = await request(`${path}/notes/${note!.id}`, action === "edit" ? "PATCH" : "DELETE", action === "edit" ? { text: "Replacement comet memory." } : undefined);
            expect(response.status).toBe(200);
        } finally {
            release?.();
            await processing;
        }
        expect(JSON.stringify(await (await request(`/search?q=${action === "edit" ? "nebula" : "comet"}`)).json())).not.toContain(text);
        if (action === "edit") {
            expect(await contexts()).toEqual([expect.objectContaining({ id: note!.id, text: "Replacement comet memory." })]);
            expect(JSON.stringify(await (await request("/search?q=comet")).json())).toContain("Replacement comet memory");
        } else expect(await contexts()).toEqual([]);
        expect(await (await request(path)).json()).toEqual(expect.objectContaining({ availability: "ready", noteIndexing: "complete", latestAttempt: expect.objectContaining({ status: "completed" }) }));
    }
}, 20000);

test.skipIf(!process.env.TEST_DATABASE_URL)("indexes attached notes independently of an unsupported file or failed Source extraction", async () => {
    const { DeterministicOriginalFileStorageFake } = await import("../src/lib/original-files/deterministic-original-file-storage-fake");
    const storage = new DeterministicOriginalFileStorageFake();
    const deterministic = new DeterministicEmbeddingProvider();
    let rejectNoteEmbeddings = false;
    const embeddingProvider = {
        representation: deterministic.representation,
        embedQuery: (text: string) => deterministic.embedQuery(text),
        async embed(text: string) {
            if (rejectNoteEmbeddings && text.includes("aurora")) throw new Error("Temporary embedding outage");
            return deterministic.embed(text);
        },
    };
    harness = await createIntegrationHarness(
        database => createApp({ database: database.db, embeddingProvider, originalFileStorage: storage, synthesisProvider: {
            async resolveQuestion({ question }) { return question; },
            async generateSynthesis({ evidence }) { return { answer: "Your own note.", citationIds: evidence.map(item => item.citationId), insufficientEvidence: false }; },
        } }),
        (database, sourceServer) => createArticleProcessingWorker({ database: database.db, clock: { now: () => new Date(Date.now() + 60000) }, maxAttempts: 1, sourceFetchOptions: sourceServer.safeFetchDependencies(), embeddingProvider, summaryProvider: new DeterministicGenerationProvider(), topicTagProvider: new DeterministicTopicTagGenerationProvider() }),
    );
    const request = (path: string, method = "GET", body?: unknown) => fetch(`${harness!.apiBaseUrl}${path}`, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
    const form = new FormData(); form.set("file", new File(["Retained opaque file."], "reminder.txt"));
    const file = await (await fetch(`${harness.apiBaseUrl}/captures/file`, { method: "POST", body: form })).json() as { knowledgeItemId: number };
    const failed = await (await request("/captures", "POST", { url: harness.sourceServer.fetchUrl("/authentication") })).json() as { knowledgeItemId: number };
    await harness.drainWorker();
    for (const [item, availability] of [[file, "unsupported"], [failed, "needs-attention"]] as const) {
        const path = `/knowledge-items/${item.knowledgeItemId}`;
        rejectNoteEmbeddings = true;
        expect((await request(`${path}/notes`, "POST", { text: "Remember the aurora project." })).status).toBe(200);
        await harness.drainWorker();
        expect(await (await request(path)).json()).toEqual(expect.objectContaining({ noteIndexing: "incomplete", availability }));
        rejectNoteEmbeddings = false;
        expect((await request(`${path}/notes/retry`, "POST")).status).toBe(202);
        await harness.drainWorker();
        expect((await request(`${path}/notes/retry`, "POST")).status).toBe(409);
        const detail = await (await request(path)).json() as { availability: string; captureContexts: Context[] };
        expect(detail.availability).toBe("ready");
        const results = await (await request("/search?q=aurora")).json() as Array<{ id: number; excerpts: Array<{ origin: string }> }>;
        expect(results.find(result => result.id === item.knowledgeItemId)?.excerpts).toEqual([expect.objectContaining({ origin: "personal-note", text: "Remember the aurora project." })]);
        const synthesis = await (await request("/synthesis", "POST", { question: "aurora" })).json() as { citations: Array<{ origin: string; sourceSnapshotId: number | null }> };
        expect(synthesis.citations).toContainEqual(expect.objectContaining({ origin: "personal-note", sourceSnapshotId: null }));
        const noteId = detail.captureContexts[0]!.id;
        expect((await request(`${path}/notes/${noteId}`, "DELETE")).status).toBe(200);
        expect(await (await request("/search?q=aurora")).json()).toEqual([]);
        if (availability === "needs-attention") expect((await request(`${path}/retry`, "POST")).status).toBe(202);
    }
    const readable = await (await request("/captures", "POST", { url: harness.sourceServer.fetchUrl("/articles/changed") })).json() as { knowledgeItemId: number };
    await harness.drainWorker();
    const readablePath = `/knowledge-items/${readable.knowledgeItemId}`;
    rejectNoteEmbeddings = true;
    await request(`${readablePath}/notes`, "POST", { text: "An aurora note recovered by Refresh." });
    await harness.drainWorker();
    expect(await (await request(readablePath)).json()).toEqual(expect.objectContaining({ noteIndexing: "incomplete" }));
    rejectNoteEmbeddings = false;
    await request(`${readablePath}/refresh`, "POST");
    await harness.drainWorker();
    expect(await (await request(readablePath)).json()).toEqual(expect.objectContaining({ availability: "ready", noteIndexing: "complete" }));
}, 20000);

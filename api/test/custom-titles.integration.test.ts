import type { KnowledgeItemView } from "../src/lib/knowledge-items/read-knowledge-items";
import type { SynthesisResult } from "../src/lib/synthesis/synthesize-knowledge";
import { afterEach, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { createArticleProcessingWorker } from "../src/worker";
import { DeterministicEmbeddingProvider, DeterministicGenerationProvider, DeterministicTopicTagGenerationProvider } from "./support/deterministic-runtime";
import { createIntegrationHarness, type IntegrationHarness } from "./support/integration-harness";
let harness: IntegrationHarness | undefined;
afterEach(async () => { await harness?.cleanup(); harness = undefined; });
test.skipIf(!process.env.TEST_DATABASE_URL)("custom titles survive processing and Refresh, reset to current source titles, and stay out of Synthesis evidence", async () => {
    const embeddingProvider = new DeterministicEmbeddingProvider();
    let evidenceTitles: string[] = [];
    harness = await createIntegrationHarness(
        database => createApp({ database: database.db, embeddingProvider, synthesisProvider: {
            async resolveQuestion({ question }) { return question; },
            async generateSynthesis({ evidence }) {
                evidenceTitles = evidence.map(item => item.title);
                return { answer: "Grounded answer.", citationIds: evidence.map(item => item.citationId), insufficientEvidence: false };
            },
        } }),
        (database, sourceServer) => createArticleProcessingWorker({ database: database.db, sourceFetchOptions: sourceServer.safeFetchDependencies(), embeddingProvider, summaryProvider: new DeterministicGenerationProvider(), topicTagProvider: new DeterministicTopicTagGenerationProvider() }),
    );
    const request = (path: string, method = "GET", body?: unknown) => fetch(`${harness!.apiBaseUrl}${path}`, {
        method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    const capture = await (await request("/captures", "POST", { url: harness.sourceServer.fetchUrl("/articles/changed") })).json() as { knowledgeItemId: number; knowledgeItem: KnowledgeItemView };
    const path = `/knowledge-items/${capture.knowledgeItemId}`;
    expect(capture.knowledgeItem.customTitle).toBeNull();
    expect((await request(`${path}/title`, "PATCH", { customTitle: "  My chosen title  " })).status).toBe(200);
    await harness.drainWorker();
    let detail = (await (await request(path)).json() as KnowledgeItemView);
    expect(detail.customTitle).toBe("My chosen title");
    expect(detail.title).toBe("My chosen title");
    expect(detail.sourcePreview?.title).toBe("Changed article: original version");
    expect(await (await request("/knowledge-items")).json()).toEqual([expect.objectContaining({ title: "My chosen title" })]);
    expect(await (await request("/search?q=provenance")).json()).toEqual([expect.objectContaining({ title: "My chosen title" })]);
    const synthesis = await (await request("/synthesis", "POST", { question: "provenance" })).json() as SynthesisResult;
    expect(synthesis.citations).toEqual(expect.arrayContaining([expect.objectContaining({ title: "My chosen title" })]));
    expect(evidenceTitles).toContain("Changed article");
    expect(evidenceTitles).not.toContain("My chosen title");
    harness.sourceServer.setChangedArticleVersion(2);
    expect((await request(`${path}/refresh`, "POST")).status).toBe(202);
    await harness.drainWorker();
    detail = (await (await request(path)).json() as KnowledgeItemView);
    expect(detail.title).toBe("My chosen title");
    expect(detail.sourcePreview?.title).toBe("Changed article: later version");
    for (const body of [{ customTitle: " " }, { customTitle: "x".repeat(501) }, { customTitle: 1 }, {}, { customTitle: "bad\nline" }]) {
        expect((await request(`${path}/title`, "PATCH", body)).status).toBe(400);
        expect(((await (await request(path)).json() as KnowledgeItemView)).title).toBe("My chosen title");
    }
    const reset = await request(`${path}/title`, "PATCH", { customTitle: null });
    expect(reset.status).toBe(200);
    expect(await reset.json()).toEqual(expect.objectContaining({ customTitle: null, title: "Changed article: later version" }));
    expect(((await (await request(path)).json() as KnowledgeItemView)).title).toBe("Changed article: later version");
    expect((await request("/knowledge-items/900000/title", "PATCH", { customTitle: "Missing" })).status).toBe(404);
    await request(`${path}/trash`, "POST");
    expect((await request(`${path}/title`, "PATCH", { customTitle: "Trashed" })).status).toBe(404);
});

test.skipIf(!process.env.TEST_DATABASE_URL)("keeps a custom title when processing reconciles a canonical Source identity", async () => {
    const embeddingProvider = new DeterministicEmbeddingProvider();
    harness = await createIntegrationHarness(
        database => createApp({ database: database.db, embeddingProvider }),
        (database, sourceServer) => createArticleProcessingWorker({ database: database.db, sourceFetchOptions: sourceServer.safeFetchDependencies(), embeddingProvider, summaryProvider: new DeterministicGenerationProvider(), topicTagProvider: new DeterministicTopicTagGenerationProvider() }),
    );
    const capture = async (path: string) => (await (await fetch(`${harness!.apiBaseUrl}/captures`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: harness!.sourceServer.fetchUrl(path) }) })).json() as { knowledgeItemId: number });
    await capture("/articles/canonical-target");
    await harness.drainWorker();
    const alias = await capture("/canonical");
    expect((await fetch(`${harness.apiBaseUrl}/knowledge-items/${alias.knowledgeItemId}/title`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ customTitle: "My canonical save" }) })).status).toBe(200);
    await harness.drainWorker();
    expect(await (await fetch(`${harness.apiBaseUrl}/knowledge-items`)).json()).toEqual([expect.objectContaining({ title: "My canonical save", customTitle: "My canonical save" })]);
});

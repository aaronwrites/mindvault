import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { createArticleProcessingWorker } from "../src/worker";
import { DeterministicEmbeddingProvider, DeterministicGenerationProvider, DeterministicTopicTagGenerationProvider, ManualClock } from "./support/deterministic-runtime";
import { createIntegrationHarness, type IntegrationHarness } from "./support/integration-harness";

let harness: IntegrationHarness | undefined;
const embeddings = new DeterministicEmbeddingProvider();
const summaries = new DeterministicGenerationProvider();
const topicTags = new DeterministicTopicTagGenerationProvider();

afterEach(async () => {
    await harness?.cleanup();
    harness = undefined;
});

describe("Extraction", () => {
    test.skipIf(!process.env.TEST_DATABASE_URL)("projects complete Source Preview facts consistently after asynchronous processing", async () => {
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: embeddings }),
            (database, sourceServer) => createArticleProcessingWorker({ database: database.db, sourceFetchOptions: sourceServer.safeFetchDependencies(), embeddingProvider: embeddings, summaryProvider: summaries, topicTagProvider: topicTags }),
        );
        const response = await fetch(`${harness.apiBaseUrl}/captures`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: harness.sourceServer.fetchUrl("/articles/preview-facts") }),
        });
        const capture = await response.json() as { knowledgeItemId: number; knowledgeItem: { sourcePreview: null } };

        expect(capture.knowledgeItem.sourcePreview).toBeNull();
        await harness.drainWorker();

        const [listResponse, detailResponse] = await Promise.all([
            fetch(`${harness.apiBaseUrl}/knowledge-items`),
            fetch(`${harness.apiBaseUrl}/knowledge-items/${capture.knowledgeItemId}`),
        ]);
        const expectedPreview = {
            title: "Trustworthy preview facts",
            description: "A source-provided description for recognizing this article.",
            websiteName: "MindVault Journal",
            author: "Ada Lovelace",
            publishedAt: "2026-08-20T00:00:00.000Z",
            contentType: "article",
            previewImageUrl: expect.stringMatching(/^\/source-preview-media\/\d+$/),
            previewImageAlt: "A durable knowledge card",
            faviconUrl: harness.sourceServer.fetchUrl("/favicon.ico"),
        };
        const listedItems = await listResponse.json() as Array<unknown>;
        expect(listedItems[0]).toEqual(expect.objectContaining({ sourcePreview: expectedPreview }));
        expect(await detailResponse.json()).toEqual(expect.objectContaining({ sourcePreview: expectedPreview }));
        const previewImageUrl = (listedItems[0] as { sourcePreview: { previewImageUrl: string } }).sourcePreview.previewImageUrl;
        harness.sourceServer.setPreviewImageAvailable(false);
        const retainedMedia = await fetch(`${harness.apiBaseUrl}${previewImageUrl}`);
        expect(retainedMedia.headers.get("content-type")).toBe("image/png");
        expect(retainedMedia.headers.get("x-content-type-options")).toBe("nosniff");
        expect(new Uint8Array(await retainedMedia.arrayBuffer())).toEqual(Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9aQAAAABJRU5ErkJggg==", "base64")));
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("persists immutable cleaned Source Snapshots without duplicating unchanged content", async () => {
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: embeddings }),
            (database, sourceServer) => createArticleProcessingWorker({ database: database.db, sourceFetchOptions: sourceServer.safeFetchDependencies(), embeddingProvider: embeddings, summaryProvider: summaries, topicTagProvider: topicTags }),
        );

        const capture = async () => {
            const response = await fetch(`${harness!.apiBaseUrl}/captures`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ url: harness!.sourceServer.fetchUrl("/articles/changed") }),
            });
            return response.json() as Promise<{ sourceId: number; knowledgeItemId: number }>;
        };

        const firstCapture = await capture();
        await harness.drainWorker();

        const secondCapture = await capture();
        await harness.drainWorker();

        harness.sourceServer.setChangedArticleVersion(2);
        const refreshResponse = await fetch(`${harness.apiBaseUrl}/knowledge-items/${firstCapture.knowledgeItemId}/refresh`, {
            method: "POST",
        });
        expect(refreshResponse.status).toBe(202);
        await harness.drainWorker();

        const refreshedItem = await fetch(`${harness.apiBaseUrl}/knowledge-items/${firstCapture.knowledgeItemId}`);
        expect(await refreshedItem.json()).toEqual(expect.objectContaining({
            availability: "ready",
            latestAttempt: expect.objectContaining({ kind: "refresh", status: "completed" }),
        }));

        const snapshots = await harness.database.pool.query<{
            id: number;
            title: string;
            primary_text: string;
            original_url: string;
            final_url: string;
            canonical_url: string | null;
            permanent_redirects: Array<{ from: string; to: string }>;
            content_hash: string;
            extracted_at: Date;
        }>(`
            SELECT id, title, primary_text, original_url, final_url, canonical_url, permanent_redirects, content_hash, extracted_at
            FROM source_snapshots
            WHERE source_id = $1
            ORDER BY id
        `, [firstCapture.sourceId]);
        const currentSnapshot = await harness.database.pool.query<{ current_snapshot_id: number | null }>(
            "SELECT current_snapshot_id FROM sources WHERE id = $1", [firstCapture.sourceId],
        );
        expect(secondCapture.sourceId).toBe(firstCapture.sourceId);
        expect(snapshots.rows).toEqual([
            expect.objectContaining({
                title: "Changed article",
                primary_text: "The original content explains how durable Source Snapshots preserve cleaned primary text and provenance after a public article changes or disappears. It is deliberately long enough to pass the meaningful-text quality threshold.",
                original_url: harness.sourceServer.fetchUrl("/articles/changed"),
                final_url: harness.sourceServer.fetchUrl("/articles/changed"),
                canonical_url: null,
                permanent_redirects: [],
                content_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
                extracted_at: expect.any(Date),
            }),
            expect.objectContaining({
                title: "Changed article",
                primary_text: "The meaningfully changed content explains how a new immutable Source Snapshot preserves a later version while earlier extracted knowledge and provenance remain available for trustworthy retrieval.",
                content_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
                extracted_at: expect.any(Date),
            }),
        ]);
        expect(snapshots.rows[0]?.content_hash).not.toBe(snapshots.rows[1]?.content_hash);
        expect(currentSnapshot.rows[0]?.current_snapshot_id).toBe(snapshots.rows[1]?.id);
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("keeps the current Preview and generated enrichment until a changed Refresh has a trustworthy representation", async () => {
        let worker: ReturnType<typeof createArticleProcessingWorker> | undefined;
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: embeddings }),
            (database, sourceServer) => {
                worker = createArticleProcessingWorker({ database: database.db, sourceFetchOptions: sourceServer.safeFetchDependencies(), embeddingProvider: embeddings, summaryProvider: summaries, topicTagProvider: topicTags });
                return worker;
            },
        );
        const captureResponse = await fetch(`${harness.apiBaseUrl}/captures`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: harness.sourceServer.fetchUrl("/articles/changed") }),
        });
        const capture = await captureResponse.json() as { knowledgeItemId: number; sourceId: number };
        await harness.drainWorker();
        const original = await (await fetch(`${harness.apiBaseUrl}/knowledge-items/${capture.knowledgeItemId}`)).json() as {
            sourcePreview: { title: string; previewImageUrl: string | null }; recognitionSummary: string | null; topicTags: string[];
        };

        harness.sourceServer.setChangedArticleVersion(2);
        const refreshResponse = await fetch(`${harness.apiBaseUrl}/knowledge-items/${capture.knowledgeItemId}/refresh`, { method: "POST" });
        expect(refreshResponse.status).toBe(202);
        await worker!.runEligibleWork(); // Extraction
        await worker!.runEligibleWork(); // Source Snapshot persistence and media retention

        const pending = await (await fetch(`${harness.apiBaseUrl}/knowledge-items/${capture.knowledgeItemId}`)).json() as typeof original & { availability: string; latestAttempt: { status: string } };
        expect(pending).toEqual(expect.objectContaining({
            availability: "ready",
            sourcePreview: original.sourcePreview,
            recognitionSummary: original.recognitionSummary,
            topicTags: original.topicTags,
            latestAttempt: expect.objectContaining({ status: "pending" }),
        }));

        await worker!.runEligibleWork(); // Passage generation
        await worker!.runEligibleWork(); // Lexical indexing
        await worker!.runEligibleWork(); // Semantic indexing
        await worker!.runEligibleWork(); // Activate the trustworthy changed representation

        const [list, detail, recall] = await Promise.all([
            fetch(`${harness.apiBaseUrl}/knowledge-items`).then(response => response.json()),
            fetch(`${harness.apiBaseUrl}/knowledge-items/${capture.knowledgeItemId}`).then(response => response.json()),
            fetch(`${harness.apiBaseUrl}/search?q=later%20version`).then(response => response.json()),
        ]) as [Array<{ sourcePreview: unknown; recognitionSummary: string | null; topicTags: string[] }>, { sourcePreview: unknown; recognitionSummary: string | null; topicTags: string[] }, Array<{ sourcePreview: unknown; recognitionSummary: string | null; topicTags: string[] }>];
        const changedPreview = expect.objectContaining({ title: "Changed article: later version", previewImageUrl: expect.stringMatching(/^\/source-preview-media\/\d+$/) });
        expect(list[0]).toEqual(expect.objectContaining({ sourcePreview: changedPreview, recognitionSummary: original.recognitionSummary, topicTags: original.topicTags }));
        expect(detail).toEqual(expect.objectContaining({ sourcePreview: changedPreview, recognitionSummary: original.recognitionSummary, topicTags: original.topicTags }));
        expect(recall[0]).toEqual(expect.objectContaining({ sourcePreview: changedPreview, recognitionSummary: original.recognitionSummary, topicTags: original.topicTags }));

        await harness.drainWorker();
        const history = await harness.database.pool.query<{ snapshot_id: number; title: string; source_url: string }>(`
            SELECT preview.source_snapshot_id AS snapshot_id, preview.title, media.source_url
            FROM source_previews AS preview
            INNER JOIN source_preview_media AS media ON media.source_snapshot_id = preview.source_snapshot_id
            WHERE preview.source_snapshot_id IN (SELECT id FROM source_snapshots WHERE source_id = $1)
            ORDER BY preview.source_snapshot_id
        `, [capture.sourceId]);
        expect(history.rows).toEqual([
            expect.objectContaining({ title: "Changed article: original version", source_url: harness.sourceServer.fetchUrl("/media/preview-one.png") }),
            expect.objectContaining({ title: "Changed article: later version", source_url: harness.sourceServer.fetchUrl("/media/preview-two.png") }),
        ]);
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("creates a new Source Snapshot when only Source Preview facts and media change", async () => {
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: embeddings }),
            (database, sourceServer) => createArticleProcessingWorker({ database: database.db, sourceFetchOptions: sourceServer.safeFetchDependencies(), embeddingProvider: embeddings, summaryProvider: summaries, topicTagProvider: topicTags }),
        );
        const captureResponse = await fetch(`${harness.apiBaseUrl}/captures`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: harness.sourceServer.fetchUrl("/articles/metadata-only-changed") }),
        });
        const capture = await captureResponse.json() as { knowledgeItemId: number; sourceId: number };
        await harness.drainWorker();

        harness.sourceServer.setMetadataOnlyArticleVersion(2);
        expect((await fetch(`${harness.apiBaseUrl}/knowledge-items/${capture.knowledgeItemId}/refresh`, { method: "POST" })).status).toBe(202);
        await harness.drainWorker();

        const item = await (await fetch(`${harness.apiBaseUrl}/knowledge-items/${capture.knowledgeItemId}`)).json() as { sourcePreview: { title: string; previewImageAlt: string | null } };
        expect(item.sourcePreview).toEqual(expect.objectContaining({ title: "Metadata-only later Preview", previewImageAlt: "Later metadata image" }));
        const snapshots = await harness.database.pool.query<{ title: string; source_url: string }>(`
            SELECT preview.title, media.source_url
            FROM source_previews AS preview
            INNER JOIN source_preview_media AS media ON media.source_snapshot_id = preview.source_snapshot_id
            WHERE preview.source_snapshot_id IN (SELECT id FROM source_snapshots WHERE source_id = $1)
            ORDER BY preview.source_snapshot_id
        `, [capture.sourceId]);
        expect(snapshots.rows).toEqual([
            { title: "Metadata-only original Preview", source_url: harness.sourceServer.fetchUrl("/media/preview-one.png") },
            { title: "Metadata-only later Preview", source_url: harness.sourceServer.fetchUrl("/media/preview-two.png") },
        ]);
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("keeps an item Ready when its optional preview image is missing", async () => {
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: embeddings }),
            (database, sourceServer) => createArticleProcessingWorker({ database: database.db, sourceFetchOptions: sourceServer.safeFetchDependencies(), embeddingProvider: embeddings, summaryProvider: summaries, topicTagProvider: topicTags }),
        );
        const response = await fetch(`${harness.apiBaseUrl}/captures`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: harness.sourceServer.fetchUrl("/articles/missing-preview-image") }),
        });
        const capture = await response.json() as { knowledgeItemId: number };

        await harness.drainWorker();

        const item = await (await fetch(`${harness.apiBaseUrl}/knowledge-items/${capture.knowledgeItemId}`)).json() as {
            availability: string;
            organizationCondition: string;
            sourcePreview: { previewImageUrl: string | null };
        };
        expect(item).toEqual(expect.objectContaining({
            availability: "ready",
            organizationCondition: "complete",
            sourcePreview: expect.objectContaining({ previewImageUrl: null }),
        }));
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("reconciles canonical Sources without losing Capture Context or Processing Attempt history", async () => {
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: embeddings }),
            (database, sourceServer) => createArticleProcessingWorker({ database: database.db, sourceFetchOptions: sourceServer.safeFetchDependencies(), embeddingProvider: embeddings, summaryProvider: summaries, topicTagProvider: topicTags }),
        );

        const firstResponse = await fetch(`${harness.apiBaseUrl}/captures`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: harness.sourceServer.fetchUrl("/canonical") , personalNote: "Captured from the declared canonical address." }),
        });
        const secondResponse = await fetch(`${harness.apiBaseUrl}/captures`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: harness.sourceServer.fetchUrl("/articles/canonical-target"), selectedText: "Captured from the resolved address." }),
        });
        const firstCapture = await firstResponse.json() as { knowledgeItemId: number; processingAttemptId: number };
        const secondCapture = await secondResponse.json() as { knowledgeItemId: number; processingAttemptId: number };

        await harness.drainWorker();

        const item = await (await fetch(`${harness.apiBaseUrl}/knowledge-items/${secondCapture.knowledgeItemId}`)).json() as {
            captureContexts: Array<{ kind: string; summary: string }>;
        };
        expect(item.captureContexts).toEqual([
            { kind: "personal-note", summary: "Captured from the declared canonical address." },
            { kind: "selected-source-text", summary: "Captured from the resolved address." },
        ]);
        const identity = await harness.database.pool.query<{
            sources: string; knowledge_items: string; attempts: string; original_url: string; final_url: string; canonical_url: string | null;
        }>(`
            SELECT
                (SELECT count(*) FROM sources)::text AS sources,
                (SELECT count(*) FROM knowledge_items)::text AS knowledge_items,
                (SELECT count(*) FROM processing_attempts WHERE knowledge_item_id = $1)::text AS attempts,
                original_url, final_url, canonical_url
            FROM extracted_sources
            WHERE processing_attempt_id = $2
        `, [secondCapture.knowledgeItemId, firstCapture.processingAttemptId]);
        expect(identity.rows).toEqual([expect.objectContaining({
            sources: "1",
            knowledge_items: "1",
            attempts: "2",
            original_url: harness.sourceServer.fetchUrl("/canonical"),
            final_url: harness.sourceServer.fetchUrl("/canonical"),
            canonical_url: harness.sourceServer.fetchUrl("/articles/canonical-target"),
        })]);
        expect(secondCapture.knowledgeItemId).not.toBe(firstCapture.knowledgeItemId);
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("keeps independent Sources distinct when their extracted content is identical", async () => {
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: embeddings }),
            (database, sourceServer) => createArticleProcessingWorker({ database: database.db, sourceFetchOptions: sourceServer.safeFetchDependencies(), embeddingProvider: embeddings, summaryProvider: summaries, topicTagProvider: topicTags }),
        );
        const capture = async (path: string) => {
            const response = await fetch(`${harness!.apiBaseUrl}/captures`, {
                method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: harness!.sourceServer.fetchUrl(path) }),
            });
            return response.json() as Promise<{ knowledgeItemId: number }>;
        };

        const [first, second] = await Promise.all([capture("/articles/independent-one"), capture("/articles/independent-two")]);
        await harness.drainWorker();

        expect(first.knowledgeItemId).not.toBe(second.knowledgeItemId);
        const counts = await harness.database.pool.query<{ sources: string; knowledge_items: string }>(`
            SELECT (SELECT count(*) FROM sources)::text AS sources, (SELECT count(*) FROM knowledge_items)::text AS knowledge_items
        `);
        expect(counts.rows).toEqual([{ sources: "2", knowledge_items: "2" }]);
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("reconciles a permanent redirect with its resolved Source", async () => {
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: embeddings }),
            (database, sourceServer) => createArticleProcessingWorker({ database: database.db, sourceFetchOptions: sourceServer.safeFetchDependencies(), embeddingProvider: embeddings, summaryProvider: summaries, topicTagProvider: topicTags }),
        );
        const capture = async (path: string) => {
            const response = await fetch(`${harness!.apiBaseUrl}/captures`, {
                method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: harness!.sourceServer.fetchUrl(path) }),
            });
            return response.json() as Promise<{ knowledgeItemId: number }>;
        };
        const [redirected, resolved] = await Promise.all([capture("/redirect/permanent"), capture("/articles/canonical-target")]);

        await harness.drainWorker();

        const counts = await harness.database.pool.query<{ sources: string; knowledge_items: string }>(`
            SELECT (SELECT count(*) FROM sources)::text AS sources, (SELECT count(*) FROM knowledge_items)::text AS knowledge_items
        `);
        expect(counts.rows).toEqual([{ sources: "1", knowledge_items: "1" }]);
        expect(redirected.knowledgeItemId).not.toBe(resolved.knowledgeItemId);
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("ignores an invalid declared canonical address without failing Extraction", async () => {
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: embeddings }),
            (database, sourceServer) => createArticleProcessingWorker({ database: database.db, sourceFetchOptions: sourceServer.safeFetchDependencies(), embeddingProvider: embeddings, summaryProvider: summaries, topicTagProvider: topicTags }),
        );
        const response = await fetch(`${harness.apiBaseUrl}/captures`, {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: harness.sourceServer.fetchUrl("/invalid-canonical") }),
        });
        const capture = await response.json() as { processingAttemptId: number };

        await harness.drainWorker();

        const extraction = await harness.database.pool.query<{ canonical_url: string | null }>(
            "SELECT canonical_url FROM extracted_sources WHERE processing_attempt_id = $1", [capture.processingAttemptId],
        );
        expect(extraction.rows).toEqual([{ canonical_url: null }]);
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("records cleaned meaningful primary text from a supported article", async () => {
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: embeddings }),
            (database, sourceServer) => createArticleProcessingWorker({ database: database.db, sourceFetchOptions: sourceServer.safeFetchDependencies(), embeddingProvider: embeddings, summaryProvider: summaries, topicTagProvider: topicTags }),
        );

        const captureResponse = await fetch(`${harness.apiBaseUrl}/captures`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: harness.sourceServer.fetchUrl("/articles/primary-text") }),
        });
        const capture = await captureResponse.json() as { knowledgeItemId: number; processingAttemptId: number };

        await harness.drainWorker();

        const itemResponse = await fetch(`${harness.apiBaseUrl}/knowledge-items/${capture.knowledgeItemId}`);
        expect(await itemResponse.json()).toEqual(expect.objectContaining({
            availability: "ready",
            source: expect.objectContaining({ kind: "public-textual-web" }),
        }));
        const extraction = await harness.database.pool.query<{ title: string; primary_text: string; raw_html_count: string }>(`
            SELECT title, primary_text,
                (SELECT count(*) FROM information_schema.columns
                 WHERE table_name = 'extracted_sources' AND column_name = 'raw_html')::text AS raw_html_count
            FROM extracted_sources
            WHERE processing_attempt_id = $1
        `, [capture.processingAttemptId]);
        expect(extraction.rows).toEqual([{
            title: "Primary article",
            primary_text: "Durable Capture stores a Source before asynchronous processing begins. This fixture explains how Extraction keeps meaningful primary text while discarding repeated page chrome and navigation. Processing Attempts make failures visible without losing the user's Capture. A cleaned representation preserves the useful material for later Source Snapshot persistence and Passage retrieval.",
            raw_html_count: "0",
        }]);
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("processes a public article that discusses authentication and bot-protection terms", async () => {
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: embeddings }),
            (database, sourceServer) => createArticleProcessingWorker({ database: database.db, sourceFetchOptions: sourceServer.safeFetchDependencies(), embeddingProvider: embeddings, summaryProvider: summaries, topicTagProvider: topicTags }),
        );
        const captureResponse = await fetch(`${harness.apiBaseUrl}/captures`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: harness.sourceServer.fetchUrl("/articles/access-language") }),
        });
        const capture = await captureResponse.json() as { knowledgeItemId: number };

        await harness.drainWorker();

        const item = await (await fetch(`${harness.apiBaseUrl}/knowledge-items/${capture.knowledgeItemId}`)).json() as {
            availability: string;
            sourcePreview: { title: string } | null;
        };
        expect(item).toEqual(expect.objectContaining({
            availability: "ready",
            sourcePreview: expect.objectContaining({ title: "Account setup guide" }),
        }));
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("extracts primary text from an article layout without semantic content elements", async () => {
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: embeddings }),
            (database, sourceServer) => createArticleProcessingWorker({ database: database.db, sourceFetchOptions: sourceServer.safeFetchDependencies(), embeddingProvider: embeddings, summaryProvider: summaries, topicTagProvider: topicTags }),
        );
        const captureResponse = await fetch(`${harness.apiBaseUrl}/captures`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: harness.sourceServer.fetchUrl("/articles/readability-layout") }),
        });
        const capture = await captureResponse.json() as { knowledgeItemId: number; processingAttemptId: number };

        await harness.drainWorker();

        const extraction = await harness.database.pool.query<{ primary_text: string }>(
            "SELECT primary_text FROM extracted_sources WHERE processing_attempt_id = $1", [capture.processingAttemptId],
        );
        expect(extraction.rows).toEqual([expect.objectContaining({
            primary_text: expect.stringContaining("content extractors identify the primary narrative"),
        })]);
        expect(extraction.rows[0]?.primary_text).not.toContain("Account navigation pricing");
        expect(extraction.rows[0]?.primary_text).not.toContain("Privacy cookies");
        const item = await (await fetch(`${harness.apiBaseUrl}/knowledge-items/${capture.knowledgeItemId}`)).json() as { availability: string };
        expect(item.availability).toBe("ready");
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("shows source-provided Preview facts when primary text is unavailable", async () => {
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: embeddings }),
            (database, sourceServer) => createArticleProcessingWorker({
                database: database.db,
                sourceFetchOptions: sourceServer.safeFetchDependencies(),
                embeddingProvider: embeddings,
                summaryProvider: summaries,
                topicTagProvider: topicTags,
                maxAttempts: 1,
            }),
        );
        const captureResponse = await fetch(`${harness.apiBaseUrl}/captures`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: harness.sourceServer.fetchUrl("/preview-only") }),
        });
        const capture = await captureResponse.json() as { knowledgeItemId: number };

        await harness.drainWorker();

        const item = await (await fetch(`${harness.apiBaseUrl}/knowledge-items/${capture.knowledgeItemId}`)).json() as {
            availability: string;
            latestAttempt: { status: string; failureReason: string };
            sourcePreview: { title: string; description: string | null; websiteName: string | null } | null;
        };
        expect(item).toEqual(expect.objectContaining({
            availability: "needs-attention",
            latestAttempt: expect.objectContaining({ status: "failed", failureReason: "This Source requires authentication" }),
            sourcePreview: expect.objectContaining({
                title: "Preview retained despite unavailable article",
                description: "Recognizable source-provided facts remain visible while primary article text is unavailable.",
                websiteName: "MindVault Journal",
            }),
        }));
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("marks a known unsupported Source as Unsupported and skips downstream work", async () => {
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: embeddings }),
            (database, sourceServer) => createArticleProcessingWorker({ database: database.db, sourceFetchOptions: sourceServer.safeFetchDependencies(), embeddingProvider: embeddings, summaryProvider: summaries, topicTagProvider: topicTags }),
        );
        const captureResponse = await fetch(`${harness.apiBaseUrl}/captures`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: harness.sourceServer.fetchUrl("/unsupported.pdf") }),
        });
        const capture = await captureResponse.json() as { knowledgeItemId: number; processingAttemptId: number };

        await harness.drainWorker();

        const itemResponse = await fetch(`${harness.apiBaseUrl}/knowledge-items/${capture.knowledgeItemId}`);
        expect(await itemResponse.json()).toEqual(expect.objectContaining({
            availability: "unsupported",
            source: expect.objectContaining({ kind: "pdf" }),
            latestAttempt: expect.objectContaining({ status: "unsupported" }),
        }));
        const stages = await harness.database.pool.query<{ status: string }>(
            "SELECT status FROM processing_stages WHERE processing_attempt_id = $1 ORDER BY id",
            [capture.processingAttemptId],
        );
        expect(stages.rows.map(stage => stage.status)).toEqual(["completed", "skipped", "skipped", "skipped", "skipped", "skipped", "skipped", "skipped"]);
    });

    for (const [path, failureReason] of [
        ["/inadequate", "This Source has inadequate meaningful text"],
        ["/authentication", "This Source requires authentication"],
        ["/bot-challenge", "This Source is protected by a bot challenge"],
        ["/paywall", "This Source is behind a paywall"],
        ["/error-page", "This Source appears to be an error page"],
    ] as const) {
        test.skipIf(!process.env.TEST_DATABASE_URL)(`shows Needs attention after Extraction rejects ${path}`, async () => {
            harness = await createIntegrationHarness(
                database => createApp({ database: database.db, embeddingProvider: embeddings }),
                (database, sourceServer) => createArticleProcessingWorker({
                    database: database.db,
                    embeddingProvider: embeddings,
                    summaryProvider: summaries,
                    topicTagProvider: topicTags,
                    maxAttempts: 1,
                    sourceFetchOptions: sourceServer.safeFetchDependencies(),
                }),
            );
            const captureResponse = await fetch(`${harness.apiBaseUrl}/captures`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ url: harness.sourceServer.fetchUrl(path) }),
            });
            const capture = await captureResponse.json() as { knowledgeItemId: number };

            await harness.drainWorker();

            const itemResponse = await fetch(`${harness.apiBaseUrl}/knowledge-items/${capture.knowledgeItemId}`);
            expect(await itemResponse.json()).toEqual(expect.objectContaining({
                availability: "needs-attention",
                latestAttempt: expect.objectContaining({ status: "failed", failureReason }),
            }));
        });
    }

    test.skipIf(!process.env.TEST_DATABASE_URL)("shows Needs attention only after bounded Extraction retries are exhausted", async () => {
        const clock = new ManualClock(new Date());
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: embeddings }),
            (database, sourceServer) => createArticleProcessingWorker({
                database: database.db,
                embeddingProvider: embeddings,
                summaryProvider: summaries,
                topicTagProvider: topicTags,
                clock,
                maxAttempts: 3,
                retryBaseDelayMs: 1_000,
                sourceFetchOptions: sourceServer.safeFetchDependencies(),
            }),
        );
        const captureResponse = await fetch(`${harness.apiBaseUrl}/captures`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: harness.sourceServer.fetchUrl("/authentication") }),
        });
        const capture = await captureResponse.json() as { knowledgeItemId: number };

        clock.advance(1_000);
        await harness.drainWorker();
        clock.advance(1_000);
        await harness.drainWorker();
        clock.advance(2_000);
        await harness.drainWorker();

        const itemResponse = await fetch(`${harness.apiBaseUrl}/knowledge-items/${capture.knowledgeItemId}`);
        expect(await itemResponse.json()).toEqual(expect.objectContaining({
            availability: "needs-attention",
            latestAttempt: expect.objectContaining({
                status: "failed",
                failureReason: "This Source requires authentication",
            }),
        }));
    });
});

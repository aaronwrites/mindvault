import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { createArticleProcessingWorker } from "../src/worker";
import { ManualClock } from "./support/deterministic-runtime";
import { createIntegrationHarness, type IntegrationHarness } from "./support/integration-harness";

let harness: IntegrationHarness | undefined;

afterEach(async () => {
    await harness?.cleanup();
    harness = undefined;
});

describe("Extraction", () => {
    test.skipIf(!process.env.TEST_DATABASE_URL)("persists immutable cleaned Source Snapshots without duplicating unchanged content", async () => {
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db }),
            (database, sourceServer) => createArticleProcessingWorker({ database: database.db, sourceFetchOptions: sourceServer.safeFetchDependencies() }),
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

    test.skipIf(!process.env.TEST_DATABASE_URL)("reconciles canonical Sources without losing Capture Context or Processing Attempt history", async () => {
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db }),
            (database, sourceServer) => createArticleProcessingWorker({ database: database.db, sourceFetchOptions: sourceServer.safeFetchDependencies() }),
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
            database => createApp({ database: database.db }),
            (database, sourceServer) => createArticleProcessingWorker({ database: database.db, sourceFetchOptions: sourceServer.safeFetchDependencies() }),
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
            database => createApp({ database: database.db }),
            (database, sourceServer) => createArticleProcessingWorker({ database: database.db, sourceFetchOptions: sourceServer.safeFetchDependencies() }),
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
            database => createApp({ database: database.db }),
            (database, sourceServer) => createArticleProcessingWorker({ database: database.db, sourceFetchOptions: sourceServer.safeFetchDependencies() }),
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
            database => createApp({ database: database.db }),
            (database, sourceServer) => createArticleProcessingWorker({ database: database.db, sourceFetchOptions: sourceServer.safeFetchDependencies() }),
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

    test.skipIf(!process.env.TEST_DATABASE_URL)("marks a known unsupported Source as Unsupported and skips downstream work", async () => {
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db }),
            (database, sourceServer) => createArticleProcessingWorker({ database: database.db, sourceFetchOptions: sourceServer.safeFetchDependencies() }),
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
        expect(stages.rows.map(stage => stage.status)).toEqual(["completed", "skipped", "skipped", "skipped", "skipped", "skipped", "skipped"]);
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
                database => createApp({ database: database.db }),
                (database, sourceServer) => createArticleProcessingWorker({
                    database: database.db,
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
            database => createApp({ database: database.db }),
            (database, sourceServer) => createArticleProcessingWorker({
                database: database.db,
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

        clock.advance(100);
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

import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { createExtractionWorker } from "../src/worker";
import { ManualClock } from "./support/deterministic-runtime";
import { createIntegrationHarness, type IntegrationHarness } from "./support/integration-harness";

let harness: IntegrationHarness | undefined;

afterEach(async () => {
    await harness?.cleanup();
    harness = undefined;
});

describe("Extraction", () => {
    test.skipIf(!process.env.TEST_DATABASE_URL)("reconciles canonical Sources without losing Capture Context or Processing Attempt history", async () => {
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db }),
            (database, sourceServer) => createExtractionWorker({ database: database.db, sourceFetchOptions: sourceServer.safeFetchDependencies() }),
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
            (database, sourceServer) => createExtractionWorker({ database: database.db, sourceFetchOptions: sourceServer.safeFetchDependencies() }),
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
            (database, sourceServer) => createExtractionWorker({ database: database.db, sourceFetchOptions: sourceServer.safeFetchDependencies() }),
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
            (database, sourceServer) => createExtractionWorker({ database: database.db, sourceFetchOptions: sourceServer.safeFetchDependencies() }),
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
            (database, sourceServer) => createExtractionWorker({ database: database.db, sourceFetchOptions: sourceServer.safeFetchDependencies() }),
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
            availability: "processing",
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
            (database, sourceServer) => createExtractionWorker({ database: database.db, sourceFetchOptions: sourceServer.safeFetchDependencies() }),
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
                (database, sourceServer) => createExtractionWorker({
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
            (database, sourceServer) => createExtractionWorker({
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

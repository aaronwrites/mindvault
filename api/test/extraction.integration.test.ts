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

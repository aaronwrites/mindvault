import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { createArticleProcessingWorker } from "../src/worker";
import { createIntegrationHarness, type IntegrationHarness } from "./support/integration-harness";

let harness: IntegrationHarness | undefined;

afterEach(async () => {
    await harness?.cleanup();
    harness = undefined;
});

describe("Passage generation", () => {
    test.skipIf(!process.env.TEST_DATABASE_URL)("creates distinct Source Snapshot and Capture Context Passages without duplicates", async () => {
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db }),
            (database, sourceServer) => createArticleProcessingWorker({ database: database.db, sourceFetchOptions: sourceServer.safeFetchDependencies() }),
        );
        const capture = async (body: Record<string, string>) => {
            const response = await fetch(`${harness!.apiBaseUrl}/captures`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ url: harness!.sourceServer.fetchUrl("/articles/primary-text"), ...body }),
            });
            expect(response.status).toBe(201);
            return response.json() as Promise<{ sourceId: number }>;
        };

        const firstCapture = await capture({
            selectedText: "This selected source text explains the reason for Capture.",
            personalNote: "This personal note records my own reason for saving it.",
        });
        await harness.drainWorker();
        await capture({});
        await harness.drainWorker();

        const passages = await harness.database.pool.query<{
            origin: string;
            text: string;
            source_snapshot_id: number | null;
            capture_context_id: number | null;
            ordinal: number;
        }>(`
            SELECT origin, text, source_snapshot_id, capture_context_id, ordinal
            FROM passages
            WHERE source_snapshot_id IN (SELECT id FROM source_snapshots WHERE source_id = $1)
               OR capture_context_id IN (
                   SELECT context.id
                   FROM capture_contexts AS context
                   JOIN captures ON captures.id = context.capture_id
                   WHERE captures.source_id = $1
               )
            ORDER BY origin, ordinal
        `, [firstCapture.sourceId]);

        expect(passages.rows).toEqual([
            {
                origin: "personal-note",
                text: "This personal note records my own reason for saving it.",
                source_snapshot_id: null,
                capture_context_id: expect.any(Number),
                ordinal: 0,
            },
            {
                origin: "selected-source-text",
                text: "This selected source text explains the reason for Capture.",
                source_snapshot_id: null,
                capture_context_id: expect.any(Number),
                ordinal: 0,
            },
            {
                origin: "source-snapshot",
                text: "Durable Capture stores a Source before asynchronous processing begins. This fixture explains how Extraction keeps meaningful primary text while discarding repeated page chrome and navigation. Processing Attempts make failures visible without losing the user's Capture. A cleaned representation preserves the useful material for later Source Snapshot persistence and Passage retrieval.",
                source_snapshot_id: expect.any(Number),
                capture_context_id: null,
                ordinal: 0,
            },
        ]);
    });
});

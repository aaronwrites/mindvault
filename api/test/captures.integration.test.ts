import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { createArticleProcessingWorker } from "../src/worker";
import {
    createIntegrationHarness,
    type IntegrationHarness,
} from "./support/integration-harness";

let harness: IntegrationHarness | undefined;

afterEach(async () => {
    await harness?.cleanup();
    harness = undefined;
});

async function startHarness(): Promise<IntegrationHarness> {
    harness = await createIntegrationHarness(database => createApp({ database: database.db }), {
        runEligibleWork: async () => 0,
    });
    return harness;
}

describe("URL Capture", () => {
    test.skipIf(!process.env.TEST_DATABASE_URL)("retains Capture Context without scheduling a Refresh when Extraction is recent", async () => {
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db }),
            (database, sourceServer) => createArticleProcessingWorker({
                database: database.db,
                sourceFetchOptions: sourceServer.safeFetchDependencies(),
            }),
        );

        const firstResponse = await fetch(`${harness.apiBaseUrl}/captures`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: harness.sourceServer.fetchUrl("/articles/primary-text") }),
        });
        const firstCapture = await firstResponse.json() as { knowledgeItemId: number };
        await harness.drainWorker();

        const repeatedResponse = await fetch(`${harness.apiBaseUrl}/captures`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                url: harness.sourceServer.fetchUrl("/articles/primary-text"),
                personalNote: "Keep the retrieval boundary in mind.",
            }),
        });

        expect(repeatedResponse.status).toBe(201);
        expect(await repeatedResponse.json()).toEqual(expect.objectContaining({
            knowledgeItemId: firstCapture.knowledgeItemId,
            processingAttemptId: null,
            availability: "ready",
        }));
        const attempts = await harness.database.pool.query<{ count: string }>(
            "SELECT count(*)::text AS count FROM processing_attempts WHERE knowledge_item_id = $1",
            [firstCapture.knowledgeItemId],
        );
        expect(attempts.rows).toEqual([{ count: "1" }]);
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("reuses a mechanically equivalent Source and Knowledge Item while retaining each Capture Context", async () => {
        const runningHarness = await startHarness();

        const firstResponse = await fetch(`${runningHarness.apiBaseUrl}/captures`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                url: "https://docs.example.com/guides/capture?topic=queues&utm_source=newsletter#overview",
                selectedText: "The first source-authored selection.",
                personalNote: "The first reason this mattered.",
            }),
        });
        const firstCapture = await firstResponse.json() as {
            captureId: number;
            sourceId: number;
            knowledgeItemId: number;
            processingAttemptId: number;
        };

        const secondResponse = await fetch(`${runningHarness.apiBaseUrl}/captures`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                url: "https://docs.example.com/guides/capture?topic=queues&utm_campaign=launch&fbclid=click-id",
                selectedText: "The later source-authored selection.",
                personalNote: "The later reason this mattered.",
            }),
        });
        const secondCapture = await secondResponse.json() as {
            captureId: number;
            sourceId: number;
            knowledgeItemId: number;
            processingAttemptId: number;
        };

        expect(firstResponse.status).toBe(201);
        expect(secondResponse.status).toBe(201);
        expect(secondCapture).toEqual(expect.objectContaining({
            sourceId: firstCapture.sourceId,
            knowledgeItemId: firstCapture.knowledgeItemId,
        }));
        expect(secondCapture.captureId).not.toBe(firstCapture.captureId);
        expect(secondCapture.processingAttemptId).not.toBe(firstCapture.processingAttemptId);

        const itemResponse = await fetch(`${runningHarness.apiBaseUrl}/knowledge-items/${firstCapture.knowledgeItemId}`);
        expect(await itemResponse.json()).toEqual(expect.objectContaining({
            source: expect.objectContaining({
                submittedUrl: "https://docs.example.com/guides/capture?topic=queues&utm_source=newsletter#overview",
                normalizedUrl: "https://docs.example.com/guides/capture?topic=queues",
            }),
            captureContexts: [
                { kind: "selected-source-text", summary: "The first source-authored selection." },
                { kind: "personal-note", summary: "The first reason this mattered." },
                { kind: "selected-source-text", summary: "The later source-authored selection." },
                { kind: "personal-note", summary: "The later reason this mattered." },
            ],
            latestAttempt: expect.objectContaining({ kind: "refresh" }),
        }));

        const { rows } = await runningHarness.database.pool.query<{
            captures: string;
            sources: string;
            knowledgeItems: string;
        }>(`
            SELECT
                (SELECT count(*) FROM captures)::text AS captures,
                (SELECT count(*) FROM sources)::text AS sources,
                (SELECT count(*) FROM knowledge_items)::text AS "knowledgeItems"
        `);
        expect(rows[0]).toEqual({ captures: "2", sources: "1", knowledgeItems: "1" });
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("keeps Sources distinct when normalized URLs differ", async () => {
        const runningHarness = await startHarness();

        const firstResponse = await fetch(`${runningHarness.apiBaseUrl}/captures`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: "https://docs.example.com/guides/capture?page=1" }),
        });
        const secondResponse = await fetch(`${runningHarness.apiBaseUrl}/captures`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: "https://docs.example.com/guides/capture?page=2" }),
        });
        const firstCapture = await firstResponse.json() as { sourceId: number; knowledgeItemId: number };
        const secondCapture = await secondResponse.json() as { sourceId: number; knowledgeItemId: number };

        expect(firstResponse.status).toBe(201);
        expect(secondResponse.status).toBe(201);
        expect(secondCapture.sourceId).not.toBe(firstCapture.sourceId);
        expect(secondCapture.knowledgeItemId).not.toBe(firstCapture.knowledgeItemId);
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("durably records a URL Capture and its initial Processing Attempt", async () => {
        const runningHarness = await startHarness();

        const response = await fetch(`${runningHarness.apiBaseUrl}/captures`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                url: "https://docs.example.com/capture",
                selectedText: "A memorable source-authored detail.",
                personalNote: "Use this in the retrieval design.",
            }),
        });

        expect(response.status).toBe(201);
        const capture = await response.json() as {
            captureId: number;
            sourceId: number;
            knowledgeItemId: number;
            processingAttemptId: number;
            availability: string;
            organizationCondition: string;
        };
        expect(capture).toEqual(expect.objectContaining({
            captureId: expect.any(Number),
            sourceId: expect.any(Number),
            knowledgeItemId: expect.any(Number),
            processingAttemptId: expect.any(Number),
            availability: "processing",
            organizationCondition: "processing",
        }));

        const listResponse = await fetch(`${runningHarness.apiBaseUrl}/knowledge-items`);
        expect(listResponse.status).toBe(200);
        expect(await listResponse.json()).toEqual([
            {
                id: capture.knowledgeItemId,
                createdAt: expect.any(String),
                source: {
                    id: capture.sourceId,
                    submittedUrl: "https://docs.example.com/capture",
                    normalizedUrl: "https://docs.example.com/capture",
                    kind: "web",
                },
                captureContexts: [
                    { kind: "selected-source-text", summary: "A memorable source-authored detail." },
                    { kind: "personal-note", summary: "Use this in the retrieval design." },
                ],
                availability: "processing",
                organizationCondition: "processing",
                recognitionSummary: null,
                topicTags: [],
                latestAttempt: {
                    id: capture.processingAttemptId,
                    kind: "initial-capture",
                    status: "pending",
                    createdAt: expect.any(String),
                },
            },
        ]);

        const detailResponse = await fetch(`${runningHarness.apiBaseUrl}/knowledge-items/${capture.knowledgeItemId}`);
        expect(detailResponse.status).toBe(200);
        expect(await detailResponse.json()).toEqual(expect.objectContaining({
            id: capture.knowledgeItemId,
            availability: "processing",
            latestAttempt: expect.objectContaining({ id: capture.processingAttemptId }),
        }));

        const { rows } = await runningHarness.database.pool.query<{
            captures: string;
            sources: string;
            knowledge_items: string;
            capture_contexts: string;
            processing_attempts: string;
            processing_stages: string;
        }>(`
            SELECT
                (SELECT count(*) FROM captures)::text AS captures,
                (SELECT count(*) FROM sources)::text AS sources,
                (SELECT count(*) FROM knowledge_items)::text AS knowledge_items,
                (SELECT count(*) FROM capture_contexts)::text AS capture_contexts,
                (SELECT count(*) FROM processing_attempts)::text AS processing_attempts,
                (SELECT count(*) FROM processing_stages)::text AS processing_stages
        `);
        expect(rows[0]).toEqual({
            captures: "1",
            sources: "1",
            knowledge_items: "1",
            capture_contexts: "2",
            processing_attempts: "1",
            processing_stages: "7",
        });
        const contexts = await runningHarness.database.pool.query<{ kind: string; text: string }>(
            "SELECT kind, text FROM capture_contexts ORDER BY kind",
        );
        expect(contexts.rows).toEqual([
            { kind: "personal-note", text: "Use this in the retrieval design." },
            { kind: "selected-source-text", text: "A memorable source-authored detail." },
        ]);
        const stages = await runningHarness.database.pool.query<{ kind: string; prerequisite: string | null }>(`
            SELECT stage.kind, prerequisite.kind AS prerequisite
            FROM processing_stages stage
            LEFT JOIN processing_stages prerequisite ON prerequisite.id = stage.prerequisite_stage_id
            ORDER BY stage.id
        `);
        expect(stages.rows).toEqual([
            { kind: "extraction", prerequisite: null },
            { kind: "snapshot-persistence", prerequisite: "extraction" },
            { kind: "passage-generation", prerequisite: "snapshot-persistence" },
            { kind: "lexical-indexing", prerequisite: "passage-generation" },
            { kind: "semantic-indexing", prerequisite: "passage-generation" },
            { kind: "recognition-summary-generation", prerequisite: "snapshot-persistence" },
            { kind: "topic-tag-generation", prerequisite: "snapshot-persistence" },
        ]);
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("rolls back every Capture record when scheduling initial work fails", async () => {
        const runningHarness = await startHarness();
        await runningHarness.database.pool.query(`
            CREATE FUNCTION reject_initial_stage() RETURNS trigger AS $$
            BEGIN
                RAISE EXCEPTION 'test stage scheduling failure';
            END;
            $$ LANGUAGE plpgsql;
            CREATE TRIGGER reject_initial_stage
            BEFORE INSERT ON processing_stages
            FOR EACH ROW EXECUTE FUNCTION reject_initial_stage();
        `);

        const response = await fetch(`${runningHarness.apiBaseUrl}/captures`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: "https://docs.example.com/atomicity" }),
        });

        expect(response.status).toBe(500);
        const { rows } = await runningHarness.database.pool.query<{
            captures: string;
            sources: string;
            knowledge_items: string;
            processing_attempts: string;
        }>(`
            SELECT
                (SELECT count(*) FROM captures)::text AS captures,
                (SELECT count(*) FROM sources)::text AS sources,
                (SELECT count(*) FROM knowledge_items)::text AS knowledge_items,
                (SELECT count(*) FROM processing_attempts)::text AS processing_attempts
        `);
        expect(rows[0]).toEqual({
            captures: "0",
            sources: "0",
            knowledge_items: "0",
            processing_attempts: "0",
        });
    });
});

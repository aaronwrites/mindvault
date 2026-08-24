import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
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

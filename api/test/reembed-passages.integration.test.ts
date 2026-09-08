import { afterEach, describe, expect, test } from "bun:test";
import type { EmbeddingProvider } from "../src/lib/ai/providers";
import { reembedRetainedPassages } from "../src/lib/ai/reembed-passages";
import { createIntegrationDatabase, type IntegrationDatabase } from "./support/integration-database";

let database: IntegrationDatabase | undefined;

afterEach(async () => {
    await database?.cleanup();
    database = undefined;
});

class ReembeddingProvider implements EmbeddingProvider {
    readonly calls: string[] = [];
    readonly representation = {
        provider: "ollama",
        model: "nomic-embed-text:latest",
        dimensions: 768,
        metadata: { digest: "sha256:new", normalization: "unit-length", prefixPolicy: "nomic-search-v1" },
    };

    constructor(private readonly failureText?: string) {}

    async embed(text: string): Promise<number[]> {
        this.calls.push(text);
        if (text === this.failureText) throw new Error("controlled interruption");
        const result = Array<number>(768).fill(0);
        result[text.length % 768] = 1;
        return result;
    }

    embedQuery(text: string): Promise<number[]> {
        return this.embed(text);
    }
}

describe("Passage re-embedding", () => {
    test.skipIf(!process.env.TEST_DATABASE_URL)("replaces only incompatible retained embeddings and resumes after failures", async () => {
        database = await createIntegrationDatabase();
        const parent = await database.pool.query<{ context_id: number }>(`
            WITH source AS (
                INSERT INTO sources (provenance_kind, source_kind) VALUES ('webpage', 'article') RETURNING id
            ), webpage AS (
                INSERT INTO webpage_sources (source_id, submitted_url, normalized_url)
                SELECT id, 'https://example.com/retained', 'https://example.com/retained' FROM source
                RETURNING source_id
            ), item AS (
                INSERT INTO knowledge_items (source_id, lifecycle_state, trashed_at)
                SELECT source_id, 'trashed', NOW() FROM webpage RETURNING id, source_id
            ), capture AS (
                INSERT INTO captures (source_id, knowledge_item_id)
                SELECT source_id, id FROM item RETURNING id
            )
            INSERT INTO capture_contexts (capture_id, kind, text)
            SELECT id, 'personal-note', 'retained context' FROM capture
            RETURNING id AS context_id
        `);
        const contextId = parent.rows[0]!.context_id;
        const passages = await database.pool.query<{ id: number; text: string }>(`
            INSERT INTO passages (capture_context_id, origin, text, ordinal)
            VALUES ($1, 'personal-note', 'old representation', 0),
                   ($1, 'personal-note', 'fails once', 1),
                   ($1, 'personal-note', 'already compatible', 2)
            RETURNING id, text
        `, [contextId]);
        const oldVector = `[1,${Array<number>(767).fill(0).join(",")}]`;
        const compatible = new ReembeddingProvider();
        await database.pool.query(`
            INSERT INTO passage_embeddings (passage_id, embedding, provider, model, dimensions, metadata)
            VALUES ($1, $3::vector, 'google', 'gemini-embedding-001', 768, '{"taskType":"RETRIEVAL_DOCUMENT"}'),
                   ($2, $3::vector, $4, $5, 768, $6::jsonb)
        `, [passages.rows[0]!.id, passages.rows[2]!.id, oldVector, compatible.representation.provider, compatible.representation.model, JSON.stringify(compatible.representation.metadata)]);

        const interrupted = new ReembeddingProvider("fails once");
        const firstReport = await reembedRetainedPassages(database.db, interrupted);
        expect(firstReport).toEqual({ processed: 1, skipped: 1, failed: 1, remaining: 1 });
        expect(interrupted.calls).toEqual(["old representation", "fails once"]);

        const resumed = new ReembeddingProvider();
        const secondReport = await reembedRetainedPassages(database.db, resumed);
        expect(secondReport).toEqual({ processed: 1, skipped: 2, failed: 0, remaining: 0 });
        expect(resumed.calls).toEqual(["fails once"]);

        const result = await database.pool.query<{ provider: string; digest: string }>(`
            SELECT embedding.provider, embedding.metadata->>'digest' AS digest
            FROM passage_embeddings AS embedding
            ORDER BY embedding.passage_id
        `);
        expect(result.rows).toEqual(Array(3).fill({ provider: "ollama", digest: "sha256:new" }));
        expect((await database.pool.query("SELECT text FROM capture_contexts")).rows).toEqual([{ text: "retained context" }]);
        expect((await database.pool.query("SELECT lifecycle_state FROM knowledge_items")).rows).toEqual([{ lifecycle_state: "trashed" }]);
    });
});

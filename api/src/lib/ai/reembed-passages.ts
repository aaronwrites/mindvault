import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";
import { validateEmbedding, type EmbeddingProvider } from "./providers";

type Database = NodePgDatabase<typeof schema>;

export type ReembeddingReport = {
    processed: number;
    skipped: number;
    failed: number;
    remaining: number;
};

export async function reembedRetainedPassages(
    database: Database,
    embeddingProvider: EmbeddingProvider,
    reportFailure: (passageId: number, error: unknown) => void = () => {},
): Promise<ReembeddingReport> {
    const report: ReembeddingReport = { processed: 0, skipped: 0, failed: 0, remaining: 0 };
    let afterPassageId = 0;

    while (true) {
        const result = await database.execute(sql<{
            id: number;
            text: string;
            compatible: boolean;
        }>`
            SELECT passage.id, passage.text,
                COALESCE(
                    embedding.provider = ${embeddingProvider.representation.provider}
                    AND embedding.model = ${embeddingProvider.representation.model}
                    AND embedding.dimensions = ${embeddingProvider.representation.dimensions}
                    AND embedding.metadata IS NOT DISTINCT FROM ${JSON.stringify(embeddingProvider.representation.metadata)}::jsonb,
                    false
                ) AS compatible
            FROM passages AS passage
            LEFT JOIN passage_embeddings AS embedding ON embedding.passage_id = passage.id
            WHERE passage.id > ${afterPassageId}
            ORDER BY passage.id
            LIMIT 100
        `);
        const rows = result.rows as Array<{ id: number; text: string; compatible: boolean }>;
        if (rows.length === 0) break;

        for (const passage of rows) {
            afterPassageId = passage.id;
            if (passage.compatible) {
                report.skipped += 1;
                continue;
            }
            try {
                const embedding = await embeddingProvider.embed(passage.text);
                validateEmbedding(embedding, embeddingProvider.representation);
                await database.execute(sql`
                    INSERT INTO passage_embeddings (passage_id, embedding, provider, model, dimensions, metadata, created_at, updated_at)
                    VALUES (
                        ${passage.id}, ${JSON.stringify(embedding)}::vector,
                        ${embeddingProvider.representation.provider}, ${embeddingProvider.representation.model},
                        ${embeddingProvider.representation.dimensions}, ${JSON.stringify(embeddingProvider.representation.metadata)}::jsonb,
                        NOW(), NOW()
                    )
                    ON CONFLICT (passage_id) DO UPDATE SET
                        embedding = EXCLUDED.embedding,
                        provider = EXCLUDED.provider,
                        model = EXCLUDED.model,
                        dimensions = EXCLUDED.dimensions,
                        metadata = EXCLUDED.metadata,
                        updated_at = NOW()
                `);
                report.processed += 1;
            } catch (error) {
                report.failed += 1;
                reportFailure(passage.id, error);
            }
        }
    }

    const remaining = await database.execute(sql<{ count: string }>`
        SELECT COUNT(*)::text AS count
        FROM passages AS passage
        LEFT JOIN passage_embeddings AS embedding ON embedding.passage_id = passage.id
        WHERE embedding.passage_id IS NULL
           OR embedding.provider IS DISTINCT FROM ${embeddingProvider.representation.provider}
           OR embedding.model IS DISTINCT FROM ${embeddingProvider.representation.model}
           OR embedding.dimensions IS DISTINCT FROM ${embeddingProvider.representation.dimensions}
           OR embedding.metadata IS DISTINCT FROM ${JSON.stringify(embeddingProvider.representation.metadata)}::jsonb
    `);
    report.remaining = Number(remaining.rows[0]?.count ?? 0);
    return report;
}

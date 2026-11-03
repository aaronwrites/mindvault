import { eq } from "drizzle-orm";
import { sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";
import { knowledgeItems, passageEmbeddings, passages, processingAttempts } from "../../db/schema";
import { validateEmbedding, type EmbeddingProvider } from "../ai/providers";
import type { ClaimedProcessingStage } from "../../worker";

type Database = NodePgDatabase<typeof schema>;

export function createSemanticIndexingStageHandler(database: Database, embeddingProvider: EmbeddingProvider) {
    return async (stage: ClaimedProcessingStage): Promise<void> => {
        const [attempt] = await database.select({
            knowledgeItemId: processingAttempts.knowledgeItemId,
            sourceSnapshotId: processingAttempts.sourceSnapshotId,
            kind: processingAttempts.kind,
        }).from(processingAttempts)
            .innerJoin(knowledgeItems, eq(knowledgeItems.id, processingAttempts.knowledgeItemId))
            .where(eq(processingAttempts.id, stage.processingAttemptId));
        if (!attempt) throw new Error("Semantic indexing could not find the Processing Attempt");
        const sourceSnapshotId = attempt.sourceSnapshotId;
        if (!sourceSnapshotId && attempt.kind !== "context-update") throw new Error("Semantic indexing could not find the Source Snapshot produced by this Processing Attempt");

        const eligiblePassages = passagesEligibleForSemanticIndex({ ...attempt, sourceSnapshotId });
        const candidates = await database.select({
            id: passages.id,
            text: passages.text,
            provider: passageEmbeddings.provider,
            model: passageEmbeddings.model,
            dimensions: passageEmbeddings.dimensions,
            metadata: passageEmbeddings.metadata,
        }).from(passages)
            .leftJoin(passageEmbeddings, eq(passageEmbeddings.passageId, passages.id))
            .where(eligiblePassages);

        for (const passage of candidates) {
            if (hasCompatibleRepresentation(passage, embeddingProvider)) continue;
            const embedding = await embeddingProvider.embed(passage.text);
            validateEmbedding(embedding, embeddingProvider.representation);
            await database.transaction(async database => {
                // The note may have changed while the provider computed this embedding.
                const [current] = await database.select({ id: passages.id }).from(passages).where(eq(passages.id, passage.id)).for("key share");
                if (!current) return;
                await database.insert(passageEmbeddings).values({
                    passageId: passage.id,
                    embedding,
                    ...embeddingProvider.representation,
                }).onConflictDoUpdate({
                    target: passageEmbeddings.passageId,
                    set: {
                        embedding,
                        ...embeddingProvider.representation,
                        updatedAt: new Date(),
                    },
                });
            });
        }

        const incomplete = await database.execute(sql`
            SELECT EXISTS (
                SELECT 1
                FROM passages
                LEFT JOIN passage_embeddings ON passage_embeddings.passage_id = passages.id
                WHERE ${eligiblePassages}
                  AND (
                      passage_embeddings.passage_id IS NULL
                      OR passage_embeddings.provider IS DISTINCT FROM ${embeddingProvider.representation.provider}
                      OR passage_embeddings.model IS DISTINCT FROM ${embeddingProvider.representation.model}
                      OR passage_embeddings.dimensions IS DISTINCT FROM ${embeddingProvider.representation.dimensions}
                      OR passage_embeddings.metadata IS DISTINCT FROM ${JSON.stringify(embeddingProvider.representation.metadata)}::jsonb
                  )
            ) AS incomplete
        `);
        if (incomplete.rows[0]?.incomplete) throw new Error("Semantic indexing did not complete every eligible Passage with a compatible representation");
    };
}

function hasCompatibleRepresentation(
    passage: { provider: string | null; model: string | null; dimensions: number | null; metadata: unknown },
    provider: EmbeddingProvider,
): boolean {
    const representation = provider.representation;
    return passage.provider === representation.provider
        && passage.model === representation.model
        && passage.dimensions === representation.dimensions
        && stableJson(passage.metadata) === stableJson(representation.metadata);
}

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
            .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
    }
    return JSON.stringify(value);
}

export function passagesEligibleForSemanticIndex(attempt: { sourceSnapshotId: number | null; knowledgeItemId: number }): SQL {
    return sql`(
        source_snapshot_id = ${attempt.sourceSnapshotId}
        OR capture_context_id IN (
            SELECT id FROM capture_contexts
            WHERE capture_id IN (
                SELECT id FROM captures WHERE knowledge_item_id = ${attempt.knowledgeItemId}
            )
        )
    )`;
}

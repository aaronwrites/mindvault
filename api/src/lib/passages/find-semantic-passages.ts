import { and, asc, cosineDistance, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";
import { passageEmbeddings, passages } from "../../db/schema";
import { validateEmbedding, type EmbeddingProvider } from "../ai/providers";

type Database = NodePgDatabase<typeof schema>;

export type SemanticPassageMatch = {
    passageId: number;
    text: string;
    distance: number;
};

export async function findSemanticPassages(database: Database, query: string, embeddingProvider: EmbeddingProvider, limit = 100): Promise<SemanticPassageMatch[]> {
    const embedding = await embeddingProvider.embedQuery(query);
    validateEmbedding(embedding, embeddingProvider.representation);
    const distance = cosineDistance(passageEmbeddings.embedding, embedding);
    const matches = await database.select({
        passageId: passages.id,
        text: passages.text,
        distance,
    }).from(passageEmbeddings)
        .innerJoin(passages, eq(passages.id, passageEmbeddings.passageId))
        .where(and(
            eq(passageEmbeddings.provider, embeddingProvider.representation.provider),
            eq(passageEmbeddings.model, embeddingProvider.representation.model),
            eq(passageEmbeddings.dimensions, embeddingProvider.representation.dimensions),
            sql`${passageEmbeddings.metadata} IS NOT DISTINCT FROM ${JSON.stringify(embeddingProvider.representation.metadata)}::jsonb`,
        ))
        .orderBy(asc(distance))
        .limit(limit);
    return matches.map(match => ({ ...match, distance: Number(match.distance) }));
}

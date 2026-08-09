import type { Request, Response } from "express";
import { cosineDistance, eq } from "drizzle-orm";
import { db } from "../db";
import { embeddings, resources } from "../db/schema";
import { generateQueryEmbedding } from "../lib/ai/embeddings";
import { attachTags } from "../lib/resource-tags";
import { searchQuerySchema } from "../schemas/search";

export const searchResources = async (req: Request, res: Response) => {
    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
    }

    try {
        const queryEmbedding = await generateQueryEmbedding(parsed.data.q);
        const distance = cosineDistance(embeddings.embedding, queryEmbedding);
        const results = await db
            .select({
                id: resources.id,
                title: resources.title,
                url: resources.url,
                sourceType: resources.sourceType,
                summary: resources.summary,
                metadata: resources.metadata,
                createdAt: resources.createdAt,
                distance,
            })
            .from(embeddings)
            .innerJoin(resources, eq(embeddings.resourceId, resources.id))
            .orderBy(distance)
            .limit(20);

        res.json(await attachTags(results));
    } catch (error) {
        console.error("Semantic search failed:", error);
        res.status(502).json({ error: "Semantic search is temporarily unavailable" });
    }
};

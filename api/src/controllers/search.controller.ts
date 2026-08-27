import type { Request, Response } from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import type { EmbeddingProvider } from "../lib/ai/providers";
import { recallKnowledgeItems } from "../lib/recall/recall-knowledge-items";
import { searchQuerySchema } from "../schemas/search";

export function recallKnowledgeItemsController(database: NodePgDatabase<typeof schema>, embeddingProvider: EmbeddingProvider) {
    return async (req: Request, res: Response) => {
        const parsed = searchQuerySchema.safeParse(req.query);
        if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

        try {
            return res.json(await recallKnowledgeItems(database, parsed.data.q, embeddingProvider));
        } catch (error) {
            console.error("Knowledge Item recall failed:", error);
            return res.status(502).json({ error: "Recall is temporarily unavailable. Please try again." });
        }
    };
}

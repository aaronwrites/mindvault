import type { Request, Response } from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import { getKnowledgeItem, listKnowledgeItems } from "../lib/knowledge-items/read-knowledge-items";
import type { EmbeddingProvider } from "../lib/ai/providers";

export function listKnowledgeItemsController(database: NodePgDatabase<typeof schema>, embeddingRepresentation: EmbeddingProvider["representation"]) {
    return async (_req: Request, res: Response) => {
        res.json(await listKnowledgeItems(database, embeddingRepresentation));
    };
}

export function getKnowledgeItemController(database: NodePgDatabase<typeof schema>, embeddingRepresentation: EmbeddingProvider["representation"]) {
    return async (req: Request, res: Response) => {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id < 1) return res.status(404).json({ error: "Knowledge Item not found" });

        const knowledgeItem = await getKnowledgeItem(database, id, embeddingRepresentation);
        if (!knowledgeItem) return res.status(404).json({ error: "Knowledge Item not found" });

        return res.json(knowledgeItem);
    };
}

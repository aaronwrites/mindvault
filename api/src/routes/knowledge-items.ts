import { Router } from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import { getKnowledgeItemController, listKnowledgeItemsController, refreshKnowledgeItemController } from "../controllers/knowledge-items.controller";
import type { EmbeddingProvider } from "../lib/ai/providers";

export function knowledgeItemsRouter(database: NodePgDatabase<typeof schema>, embeddingRepresentation: EmbeddingProvider["representation"]) {
    const router = Router();
    router.get("/", listKnowledgeItemsController(database, embeddingRepresentation));
    router.post("/:id/refresh", refreshKnowledgeItemController(database, embeddingRepresentation));
    router.get("/:id", getKnowledgeItemController(database, embeddingRepresentation));
    return router;
}

import { Router } from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import type { EmbeddingProvider } from "../lib/ai/providers";
import { recallKnowledgeItemsController } from "../controllers/search.controller";

export function searchRouter(database: NodePgDatabase<typeof schema>, embeddingProvider: EmbeddingProvider) {
    const router = Router();
    router.get("/", recallKnowledgeItemsController(database, embeddingProvider));
    return router;
}

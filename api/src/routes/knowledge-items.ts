import { Router } from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import { getKnowledgeItemController, listKnowledgeItemsController } from "../controllers/knowledge-items.controller";

export function knowledgeItemsRouter(database: NodePgDatabase<typeof schema>) {
    const router = Router();
    router.get("/", listKnowledgeItemsController(database));
    router.get("/:id", getKnowledgeItemController(database));
    return router;
}

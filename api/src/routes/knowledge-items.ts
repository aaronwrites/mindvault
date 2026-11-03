import { Router } from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import { updateKnowledgeItemTitleController, accessOriginalFileController, getKnowledgeItemController, listKnowledgeItemsController, listTrashedKnowledgeItemsController, permanentlyDeleteKnowledgeItemController, refreshKnowledgeItemController, restoreKnowledgeItemController, retryKnowledgeItemController, trashKnowledgeItemController } from "../controllers/knowledge-items.controller";
import type { EmbeddingProvider } from "../lib/ai/providers";
import type { OriginalFileStorage } from "../lib/original-files/original-file-storage";

export function knowledgeItemsRouter(database: NodePgDatabase<typeof schema>, embeddingRepresentation: EmbeddingProvider["representation"], originalFileStorage: () => OriginalFileStorage) {
    const router = Router();
    router.get("/", listKnowledgeItemsController(database, embeddingRepresentation));
    router.get("/trash", listTrashedKnowledgeItemsController(database, embeddingRepresentation));
    router.post("/:id/trash", trashKnowledgeItemController(database));
    router.post("/:id/restore", restoreKnowledgeItemController(database, embeddingRepresentation));
    router.post("/:id/permanent-delete", permanentlyDeleteKnowledgeItemController(database));
    router.post("/:id/refresh", refreshKnowledgeItemController(database, embeddingRepresentation));
    router.post("/:id/retry", retryKnowledgeItemController(database, embeddingRepresentation));
    router.get("/:id/original-file/open", accessOriginalFileController(database, originalFileStorage, "open"));
    router.get("/:id/original-file/download", accessOriginalFileController(database, originalFileStorage, "download"));
    router.patch("/:id/title", updateKnowledgeItemTitleController(database, embeddingRepresentation));
    router.get("/:id", getKnowledgeItemController(database, embeddingRepresentation));
    return router;
}

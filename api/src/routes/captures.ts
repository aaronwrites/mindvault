import { Router } from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import { createCapture, createOriginalFileCapture } from "../controllers/captures.controller";
import type { EmbeddingProvider } from "../lib/ai/providers";
import type { OriginalFileStorage } from "../lib/original-files/original-file-storage";

export function capturesRouter(database: NodePgDatabase<typeof schema>, embeddingRepresentation: EmbeddingProvider["representation"], originalFileStorage: () => OriginalFileStorage, maximumOriginalFileBytes?: number) {
    const router = Router();
    router.post("/", createCapture(database, embeddingRepresentation));
    router.post("/file", createOriginalFileCapture(database, embeddingRepresentation, originalFileStorage, maximumOriginalFileBytes));
    return router;
}

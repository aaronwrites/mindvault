import { Router } from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import { createCapture } from "../controllers/captures.controller";
import type { EmbeddingProvider } from "../lib/ai/providers";

export function capturesRouter(database: NodePgDatabase<typeof schema>, embeddingRepresentation: EmbeddingProvider["representation"]) {
    const router = Router();
    router.post("/", createCapture(database, embeddingRepresentation));
    return router;
}

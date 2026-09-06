import { Router } from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import type { EmbeddingProvider, SynthesisGenerationProvider } from "../lib/ai/providers";
import { synthesizeKnowledgeController } from "../controllers/synthesis.controller";

export function synthesisRouter(
    database: NodePgDatabase<typeof schema>,
    embeddingProvider: EmbeddingProvider,
    generationProvider: SynthesisGenerationProvider,
) {
    const router = Router();
    router.post("/", synthesizeKnowledgeController(database, embeddingProvider, generationProvider));
    return router;
}

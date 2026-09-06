import cors from "cors";
import express from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./db/schema";
import { db } from "./db";
import { capturesRouter } from "./routes/captures";
import { knowledgeItemsRouter } from "./routes/knowledge-items";
import { searchRouter } from "./routes/search";
import { sourcePreviewMediaRouter } from "./routes/source-preview-media";
import { createGeminiPassageEmbeddingProvider } from "./lib/ai/embeddings";
import { createGeminiSynthesisGenerationProvider } from "./lib/ai/gemini";
import type { EmbeddingProvider, SynthesisGenerationProvider } from "./lib/ai/providers";
import { cloudinaryOriginalFileStorageFromEnvironment } from "./lib/original-files/cloudinary-original-file-storage";
import type { OriginalFileStorage } from "./lib/original-files/original-file-storage";
import { synthesisRouter } from "./routes/synthesis";

type AppDependencies = {
    database?: NodePgDatabase<typeof schema>;
    embeddingProvider?: EmbeddingProvider;
    synthesisProvider?: SynthesisGenerationProvider;
    originalFileStorage?: OriginalFileStorage;
    maximumOriginalFileBytes?: number;
};

export function createApp({ database = db, embeddingProvider = createGeminiPassageEmbeddingProvider(), synthesisProvider = createGeminiSynthesisGenerationProvider(), originalFileStorage, maximumOriginalFileBytes }: AppDependencies = {}) {
    const app = express();
    app.use(cors());
    app.use(express.json());

    const configuredMaximumOriginalFileBytes = maximumOriginalFileBytes ?? positiveInteger(process.env.ORIGINAL_FILE_MAXIMUM_BYTES);
    app.use("/captures", capturesRouter(database, embeddingProvider.representation, () => originalFileStorage ?? cloudinaryOriginalFileStorageFromEnvironment(process.env), configuredMaximumOriginalFileBytes));
    app.use("/knowledge-items", knowledgeItemsRouter(database, embeddingProvider.representation, () => originalFileStorage ?? cloudinaryOriginalFileStorageFromEnvironment(process.env)));
    app.use("/search", searchRouter(database, embeddingProvider));
    app.use("/synthesis", synthesisRouter(database, embeddingProvider, synthesisProvider));
    app.use("/source-preview-media", sourcePreviewMediaRouter(database));
    app.get("/health", (_req, res) => res.json({ status: "ok" }));

    return app;
}

function positiveInteger(value: string | undefined): number | undefined {
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

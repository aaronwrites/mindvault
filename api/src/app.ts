import cors from "cors";
import express from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./db/schema";
import { db } from "./db";
import { capturesRouter } from "./routes/captures";
import { knowledgeItemsRouter } from "./routes/knowledge-items";
import { resourcesRouter } from "./routes/resources";
import { searchRouter } from "./routes/search";
import { createGeminiPassageEmbeddingProvider } from "./lib/ai/embeddings";
import type { EmbeddingProvider } from "./lib/ai/providers";

type AppDependencies = {
    database?: NodePgDatabase<typeof schema>;
    embeddingProvider?: EmbeddingProvider;
};

export function createApp({ database = db, embeddingProvider = createGeminiPassageEmbeddingProvider() }: AppDependencies = {}) {
    const app = express();
    app.use(cors());
    app.use(express.json());

    app.use("/resources", resourcesRouter);
    app.use("/captures", capturesRouter(database, embeddingProvider.representation));
    app.use("/knowledge-items", knowledgeItemsRouter(database, embeddingProvider.representation));
    app.use("/search", searchRouter);
    app.get("/health", (_req, res) => res.json({ status: "ok" }));

    return app;
}

import cors from "cors";
import express from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./db/schema";
import { db } from "./db";
import { capturesRouter } from "./routes/captures";
import { resourcesRouter } from "./routes/resources";
import { searchRouter } from "./routes/search";

type AppDependencies = {
    database?: NodePgDatabase<typeof schema>;
};

export function createApp({ database = db }: AppDependencies = {}) {
    const app = express();
    app.use(cors());
    app.use(express.json());

    app.use("/resources", resourcesRouter);
    app.use("/captures", capturesRouter(database));
    app.use("/search", searchRouter);
    app.get("/health", (_req, res) => res.json({ status: "ok" }));

    return app;
}

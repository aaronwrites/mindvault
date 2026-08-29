import { Router } from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import { getSourcePreviewMediaController } from "../controllers/source-preview-media.controller";

export function sourcePreviewMediaRouter(database: NodePgDatabase<typeof schema>) {
    const router = Router();
    router.get("/:sourceSnapshotId", getSourcePreviewMediaController(database));
    return router;
}

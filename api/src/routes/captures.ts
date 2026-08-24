import { Router } from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import { createCapture } from "../controllers/captures.controller";

export function capturesRouter(database: NodePgDatabase<typeof schema>) {
    const router = Router();
    router.post("/", createCapture(database));
    return router;
}

import type { Request, Response } from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import { persistUrlCapture } from "../lib/capture/persist-url-capture";
import { createCaptureSchema } from "../schemas/capture";

export function createCapture(database: NodePgDatabase<typeof schema>) {
    return async (req: Request, res: Response) => {
        const parsed = createCaptureSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.flatten() });
        }

        try {
            const result = await persistUrlCapture(database, parsed.data);

            return res.status(201).json(result);
        } catch (error) {
            console.error("Failed to persist Capture:", error);
            return res.status(500).json({ error: "Unable to persist Capture" });
        }
    };
}

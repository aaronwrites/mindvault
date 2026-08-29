import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import { sourcePreviewMedia } from "../db/schema";

export function getSourcePreviewMediaController(database: NodePgDatabase<typeof schema>) {
    return async (req: Request, res: Response) => {
        const sourceSnapshotId = Number(req.params.sourceSnapshotId);
        if (!Number.isSafeInteger(sourceSnapshotId) || sourceSnapshotId < 1) return res.status(404).end();

        const [media] = await database.select().from(sourcePreviewMedia)
            .where(eq(sourcePreviewMedia.sourceSnapshotId, sourceSnapshotId));
        if (!media) return res.status(404).end();

        res.set({
            "Content-Type": media.contentType,
            "Content-Length": String(media.bytes.byteLength),
            "Cache-Control": "private, max-age=31536000, immutable",
            "Content-Disposition": "inline",
            "Cross-Origin-Resource-Policy": "same-origin",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        });
        return res.send(media.bytes);
    };
}

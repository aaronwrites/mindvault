import type { Request, Response } from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import { persistUrlCapture } from "../lib/capture/persist-url-capture";
import { getKnowledgeItem } from "../lib/knowledge-items/read-knowledge-items";
import { createCaptureSchema } from "../schemas/capture";
import type { EmbeddingProvider } from "../lib/ai/providers";
import { classifyOriginalFile, OriginalFileRequestError, receiveOriginalFile } from "../lib/capture/receive-original-file";
import { OriginalFileDeletionPendingError, persistOriginalFileCapture } from "../lib/capture/persist-original-file-capture";
import { OriginalFileStorageError, type OriginalFileStorage } from "../lib/original-files/original-file-storage";

export function createCapture(database: NodePgDatabase<typeof schema>, embeddingRepresentation: EmbeddingProvider["representation"]) {
    return async (req: Request, res: Response) => {
        const parsed = createCaptureSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.flatten() });
        }

        try {
            const result = await persistUrlCapture(database, parsed.data);
            const knowledgeItem = await getKnowledgeItem(database, result.knowledgeItemId, embeddingRepresentation);
            if (!knowledgeItem) throw new Error("Captured Knowledge Item could not be read");

            return res.status(201).json({
                ...result,
                availability: knowledgeItem.availability,
                organizationCondition: knowledgeItem.organizationCondition,
                knowledgeItem,
            });
        } catch (error) {
            console.error("Failed to persist Capture:", error);
            return res.status(500).json({ error: "Unable to persist Capture" });
        }
    };
}

export function createOriginalFileCapture(
    database: NodePgDatabase<typeof schema>,
    embeddingRepresentation: EmbeddingProvider["representation"],
    storage: () => OriginalFileStorage,
    maximumOriginalFileBytes?: number,
) {
    return async (req: Request, res: Response) => {
        let file;
        try {
            file = await receiveOriginalFile(req, maximumOriginalFileBytes);
            const classification = await classifyOriginalFile(file);
            const result = await persistOriginalFileCapture(database, storage(), file, classification);
            const knowledgeItem = await getKnowledgeItem(database, result.knowledgeItemId, embeddingRepresentation);
            if (!knowledgeItem) throw new Error("Captured Knowledge Item could not be read");
            return res.status(201).json({ ...result, availability: knowledgeItem.availability, organizationCondition: knowledgeItem.organizationCondition, knowledgeItem });
        } catch (error) {
            if (error instanceof OriginalFileRequestError) {
                const status = error.code === "file-too-large" ? 413 : 400;
                return res.status(status).json({ error: error.code });
            }
            if (error instanceof OriginalFileStorageError) {
                if (error.kind === "rejected") {
                    console.warn("Original File storage rejected the upload:", error.message);
                    return res.status(422).json({ error: "original-file-storage-rejected", retryable: false });
                }
                const errorCode = error.kind === "configuration" ? "original-file-storage-unconfigured" : "original-file-storage-unavailable";
                if (error.kind !== "configuration") console.warn("Original File storage request failed:", error.message);
                return res.status(503).json({ error: errorCode, retryable: true });
            }
            if (error instanceof OriginalFileDeletionPendingError) {
                return res.status(409).json({ error: "original-file-deletion-pending", retryable: true });
            }
            console.error("Failed to persist Original File Capture:", error);
            return res.status(500).json({ error: "Unable to persist Original File Capture" });
        } finally {
            await file?.cleanup();
        }
    };
}

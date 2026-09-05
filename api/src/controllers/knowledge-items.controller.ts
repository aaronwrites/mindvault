import type { Request, Response } from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import { getKnowledgeItem, listKnowledgeItems } from "../lib/knowledge-items/read-knowledge-items";
import { restoreKnowledgeItem, trashKnowledgeItem } from "../lib/knowledge-items/trash-knowledge-item";
import { createManualRetryProcessingAttempt, createRefreshProcessingAttempt } from "../lib/processing/create-processing-attempt";
import type { EmbeddingProvider } from "../lib/ai/providers";
import { createOriginalFileAccess } from "../lib/original-files/create-original-file-access";
import type { OriginalFileStorage } from "../lib/original-files/original-file-storage";
import { requestPermanentDeletion } from "../lib/original-files/process-original-file-operations";

export function listKnowledgeItemsController(database: NodePgDatabase<typeof schema>, embeddingRepresentation: EmbeddingProvider["representation"]) {
    return async (_req: Request, res: Response) => {
        res.json(await listKnowledgeItems(database, embeddingRepresentation));
    };
}

export function listTrashedKnowledgeItemsController(database: NodePgDatabase<typeof schema>, embeddingRepresentation: EmbeddingProvider["representation"]) {
    return async (_req: Request, res: Response) => {
        res.json(await listKnowledgeItems(database, embeddingRepresentation, "trashed"));
    };
}

export function trashKnowledgeItemController(database: NodePgDatabase<typeof schema>) {
    return async (req: Request, res: Response) => {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id < 1) return res.status(404).json({ error: "Knowledge Item not found" });
        if (await trashKnowledgeItem(database, id) === "not-found") return res.status(404).json({ error: "Knowledge Item not found" });
        return res.status(204).end();
    };
}

export function restoreKnowledgeItemController(database: NodePgDatabase<typeof schema>, embeddingRepresentation: EmbeddingProvider["representation"]) {
    return async (req: Request, res: Response) => {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id < 1) return res.status(404).json({ error: "Knowledge Item not found" });
        if (await restoreKnowledgeItem(database, id) === "not-found") return res.status(404).json({ error: "Knowledge Item not found" });
        const knowledgeItem = await getKnowledgeItem(database, id, embeddingRepresentation);
        if (!knowledgeItem) throw new Error("Restored Knowledge Item could not be read");
        return res.json({ knowledgeItem });
    };
}

export function permanentlyDeleteKnowledgeItemController(database: NodePgDatabase<typeof schema>) {
    return async (req: Request, res: Response) => {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id < 1 || req.body?.confirmation !== "permanently-delete") {
            return res.status(404).json({ error: "Knowledge Item not found" });
        }
        const outcome = await requestPermanentDeletion(database, id);
        if (outcome === "not-found") return res.status(404).json({ error: "Knowledge Item not found" });
        return outcome === "pending" ? res.status(202).json({ deletionPending: true }) : res.status(204).end();
    };
}

export function getKnowledgeItemController(database: NodePgDatabase<typeof schema>, embeddingRepresentation: EmbeddingProvider["representation"]) {
    return async (req: Request, res: Response) => {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id < 1) return res.status(404).json({ error: "Knowledge Item not found" });

        const knowledgeItem = await getKnowledgeItem(database, id, embeddingRepresentation);
        if (!knowledgeItem) return res.status(404).json({ error: "Knowledge Item not found" });

        return res.json(knowledgeItem);
    };
}

export function refreshKnowledgeItemController(database: NodePgDatabase<typeof schema>, embeddingRepresentation: EmbeddingProvider["representation"]) {
    return async (req: Request, res: Response) => {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id < 1) return res.status(404).json({ error: "Knowledge Item not found" });

        try {
            const processingAttemptId = await createRefreshProcessingAttempt(database, id);
            if (!processingAttemptId) return res.status(404).json({ error: "Knowledge Item not found" });
            const knowledgeItem = await getKnowledgeItem(database, id, embeddingRepresentation);
            if (!knowledgeItem) throw new Error("Refreshed Knowledge Item could not be read");
            return res.status(202).json({ processingAttemptId, knowledgeItem });
        } catch (error) {
            console.error("Failed to schedule Refresh:", error);
            return res.status(500).json({ error: "Unable to refresh Knowledge Item" });
        }
    };
}

export function retryKnowledgeItemController(database: NodePgDatabase<typeof schema>, embeddingRepresentation: EmbeddingProvider["representation"]) {
    return async (req: Request, res: Response) => {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id < 1) return res.status(404).json({ error: "Knowledge Item not found" });

        const existingItem = await getKnowledgeItem(database, id, embeddingRepresentation);
        if (!existingItem) return res.status(404).json({ error: "Knowledge Item not found" });

        try {
            const processingAttemptId = await createManualRetryProcessingAttempt(database, id);
            if (processingAttemptId === "not-found") return res.status(404).json({ error: "Knowledge Item not found" });
            if (processingAttemptId === "not-actionable") {
                return res.status(409).json({ error: "This Knowledge Item has no failed retrieval work to retry" });
            }
            const knowledgeItem = await getKnowledgeItem(database, id, embeddingRepresentation);
            if (!knowledgeItem) throw new Error("Retried Knowledge Item could not be read");
            return res.status(202).json({ processingAttemptId, knowledgeItem });
        } catch (error) {
            console.error("Failed to schedule manual retry:", error);
            return res.status(500).json({ error: "Unable to retry Knowledge Item processing" });
        }
    };
}

export function accessOriginalFileController(database: NodePgDatabase<typeof schema>, storage: () => OriginalFileStorage, action: "open" | "download") {
    return async (req: Request, res: Response) => {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id < 1) return res.status(404).json({ error: "Original File unavailable" });

        const result = await createOriginalFileAccess(database, storage, id, action);
        if (result.outcome === "ready") return res.redirect(302, result.access.url);
        if (result.outcome === "provider-unavailable") return res.status(503).json({ error: "original-file-access-unavailable", retryable: true });
        return res.status(404).json({ error: result.outcome === "open-not-available" ? "Original File cannot be opened safely" : "Original File unavailable" });
    };
}

import { findOrCreateTopicTag } from "../lib/topic-tags/generate-topic-tags";
import { displayTopicTagName, normalizeTopicTagAlias } from "../lib/topic-tags/normalize-topic-tag";
import { and, eq } from "drizzle-orm";
import { updateTagsSchema, updateTitleSchema } from "../schemas/knowledge-item";
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

        const page = req.query.page === undefined ? undefined : Number(req.query.page);
        if (page !== undefined && (action !== "open" || typeof req.query.page !== "string" || !Number.isSafeInteger(page) || page < 1)) {
            return res.status(400).json({ error: "Invalid physical PDF page" });
        }
        const result = await createOriginalFileAccess(database, storage, id, action, page);
        if (result.outcome === "ready") return res.redirect(302, result.access.url);
        if (result.outcome === "provider-unavailable") return res.status(503).json({ error: "original-file-access-unavailable", retryable: true });
        return res.status(404).json({ error: result.outcome === "open-not-available" ? "Original File cannot be opened safely" : "Original File unavailable" });
    };
}

export function updateKnowledgeItemTitleController(database: NodePgDatabase<typeof schema>, embeddingRepresentation: EmbeddingProvider["representation"]) {
    return async (req: Request, res: Response) => {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id < 1) return res.status(404).json({ error: "Knowledge Item not found" });
        const parsed = updateTitleSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: "Use a title of 1–500 characters without line breaks or control characters." });
        const [updated] = await database.update(schema.knowledgeItems).set({ customTitle: parsed.data.customTitle })
            .where(and(eq(schema.knowledgeItems.id, id), eq(schema.knowledgeItems.lifecycleState, "active"))).returning({ id: schema.knowledgeItems.id });
        if (!updated) return res.status(404).json({ error: "Knowledge Item not found" });
        const item = await getKnowledgeItem(database, id, embeddingRepresentation);
        if (!item) return res.status(404).json({ error: "Knowledge Item not found" });
        return res.json(item);
    };
}

export function updateKnowledgeItemTagsController(database: NodePgDatabase<typeof schema>, embeddingRepresentation: EmbeddingProvider["representation"]) {
    return async (req: Request, res: Response) => {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id < 1) return res.status(404).json({ error: "Knowledge Item not found" });
        const parsed = updateTagsSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: "Use tag names of 1–100 characters without line breaks or control characters." });
        const found = await database.transaction(async transaction => {
            // Serialize edits without blocking generated assignments’ foreign-key checks.
            const [item] = await transaction.select({ id: schema.knowledgeItems.id }).from(schema.knowledgeItems)
                .where(and(eq(schema.knowledgeItems.id, id), eq(schema.knowledgeItems.lifecycleState, "active"))).for("no key update");
            if (!item) return false;
            // Add wins when both operations resolve to the same canonical identity.
            for (const [choice, names] of [["rejected", parsed.data.remove], ["added", parsed.data.add]] as const) {
                for (const name of names) {
                    const canonicalName = displayTopicTagName(name);
                    const normalizedName = normalizeTopicTagAlias(name);
                    const topicTagId = await findOrCreateTopicTag(transaction, { canonicalName, normalizedName, aliases: [{ alias: canonicalName, normalizedAlias: normalizedName }] });
                    await transaction.insert(schema.topicTagCorrections).values({ knowledgeItemId: id, topicTagId, choice })
                        .onConflictDoUpdate({ target: [schema.topicTagCorrections.knowledgeItemId, schema.topicTagCorrections.topicTagId], set: { choice } });
                }
            }
            return true;
        });
        if (!found) return res.status(404).json({ error: "Knowledge Item not found" });
        return res.json(await getKnowledgeItem(database, id, embeddingRepresentation));
    };
}

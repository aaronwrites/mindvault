import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, eq, sql } from "drizzle-orm";
import * as schema from "../../db/schema";
import { captureContexts, captures, knowledgeItems, originalFileOperations, originalFiles, sources } from "../../db/schema";
import type { OriginalFileClassification, ReceivedOriginalFile } from "./receive-original-file";
import { OriginalFileStorageError, type OriginalFileStorage } from "../original-files/original-file-storage";

import { createProcessingAttempt } from "../processing/create-processing-attempt";

type Database = NodePgDatabase<typeof schema>;
export type PersistedOriginalFileCapture = { captureId: number; sourceId: number; knowledgeItemId: number; processingAttemptId: number | null; reused: boolean; restoredFromTrash: boolean };
type OriginalFileCaptureIntent =
    | { kind: "capture"; capture: PersistedOriginalFileCapture }
    | { kind: "upload"; sourceId: number; existing: boolean };

export class OriginalFileDeletionPendingError extends Error {
    constructor() {
        super("An identical Original File is being permanently deleted");
        this.name = "OriginalFileDeletionPendingError";
    }
}

export async function persistOriginalFileCapture(database: Database, storage: OriginalFileStorage, file: ReceivedOriginalFile, classification: OriginalFileClassification): Promise<PersistedOriginalFileCapture> {
    const providerIdentity = `sha256:${file.contentHash}`;
    const intent = await database.transaction<OriginalFileCaptureIntent>(async transaction => {
        await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${file.contentHash}, 0))`);
        const existing = (await transaction.select({ originalFile: originalFiles }).from(originalFiles).where(eq(originalFiles.contentHash, file.contentHash)))[0]?.originalFile;
        if (existing) {
            const [item] = await transaction.select({ lifecycleState: knowledgeItems.lifecycleState }).from(knowledgeItems)
                .where(eq(knowledgeItems.sourceId, existing.sourceId));
            if (item?.lifecycleState === "pending-permanent-deletion") throw new OriginalFileDeletionPendingError();
            // A retry owns this upload again. Any old reconciliation job must not
            // remove the Source while the request is completing the Capture.
            await transaction.update(originalFileOperations).set({
                status: "completed",
                leaseToken: null,
                leaseExpiresAt: null,
                failureReason: null,
            }).where(and(eq(originalFileOperations.originalFileSourceId, existing.sourceId), eq(originalFileOperations.kind, "upload")));
            // A stored file can have a stale upload-reconciliation operation from a
            // previous interrupted request. Create its Capture while this transaction
            // is still open, so that worker cannot delete its Source between deciding
            // to reuse it and creating the Knowledge Item.
            if (existing.storageState === "stored") {
                return { kind: "capture", capture: await createCapture(transaction, existing.sourceId, file, true) };
            }
            return { kind: "upload", sourceId: existing.sourceId, existing: true };
        }
        const [source] = await transaction.insert(sources).values({ provenanceKind: "original-file", sourceKind: classification.sourceKind }).returning();
        if (!source) throw new Error("Original File Source was not created");
        await transaction.insert(originalFiles).values({ sourceId: source.id, contentHash: file.contentHash, byteSize: file.byteSize, detectedMediaType: classification.mediaType, detectedSourceKind: classification.sourceKind, storageProvider: storage.provider, providerIdentity, storageState: "pending-upload" });
        return { kind: "upload", sourceId: source.id, existing: false };
    });

    if (intent.kind === "capture") return intent.capture;
    try {
        const stored = await storage.upload({ localPath: file.localPath, providerIdentity, mediaType: classification.mediaType });
        return await database.transaction(async transaction => {
            await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${file.contentHash}, 0))`);
            await transaction.update(originalFiles).set({ storageLocator: stored.locator, storageState: "stored" }).where(eq(originalFiles.sourceId, intent.sourceId));
            await transaction.update(originalFileOperations).set({
                status: "completed",
                leaseToken: null,
                leaseExpiresAt: null,
            }).where(eq(originalFileOperations.originalFileSourceId, intent.sourceId));
            return createCapture(transaction, intent.sourceId, file, intent.existing || stored.reused);
        });
    } catch (error) {
        if (!intent.existing && error instanceof OriginalFileStorageError && error.kind !== "ambiguous") {
            await database.delete(sources).where(eq(sources.id, intent.sourceId));
        }
        if (error instanceof OriginalFileStorageError && error.kind === "ambiguous") {
            await database.insert(originalFileOperations).values({ originalFileSourceId: intent.sourceId, kind: "upload" })
                .onConflictDoUpdate({
                    target: [originalFileOperations.originalFileSourceId, originalFileOperations.kind],
                    set: { status: "pending", availableAt: new Date(), leaseToken: null, leaseExpiresAt: null, failureReason: null },
                });
        }
        throw error;
    }
}

async function createCapture(database: Database, sourceId: number, file: ReceivedOriginalFile, reused: boolean): Promise<PersistedOriginalFileCapture> {
    const knowledgeItem = (await database.select().from(knowledgeItems).where(eq(knowledgeItems.sourceId, sourceId)))[0]
        ?? (await database.insert(knowledgeItems).values({ sourceId }).returning())[0];
    if (!knowledgeItem) throw new Error("Knowledge Item was not created");
    const restoredFromTrash = knowledgeItem.lifecycleState === "trashed";
    if (restoredFromTrash) {
        await database.update(knowledgeItems).set({ lifecycleState: "active", trashedAt: null, deletionRequestedAt: null })
            .where(eq(knowledgeItems.id, knowledgeItem.id));
    }
    const [capture] = await database.insert(captures).values({ sourceId, knowledgeItemId: knowledgeItem.id, submittedFilename: file.filename }).returning();
    if (!capture) throw new Error("Capture was not created");
    if (file.personalNote) await database.insert(captureContexts).values({ captureId: capture.id, kind: "personal-note", text: file.personalNote });
    const [source] = await database.select({ sourceKind: sources.sourceKind }).from(sources).where(eq(sources.id, sourceId));
    const processingAttemptId = source?.sourceKind === "pdf"
        ? await createProcessingAttempt(database, knowledgeItem.id, reused ? "refresh" : "initial-capture") : null;
    return { captureId: capture.id, sourceId, knowledgeItemId: knowledgeItem.id, processingAttemptId, reused, restoredFromTrash };
}

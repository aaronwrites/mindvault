import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import * as schema from "../../db/schema";
import { captureContexts, captures, knowledgeItems, originalFileOperations, originalFiles, sources } from "../../db/schema";
import type { OriginalFileClassification, ReceivedOriginalFile } from "./receive-original-file";
import { OriginalFileStorageError, type OriginalFileStorage } from "../original-files/original-file-storage";

type Database = NodePgDatabase<typeof schema>;
export type PersistedOriginalFileCapture = { captureId: number; sourceId: number; knowledgeItemId: number; processingAttemptId: null; reused: boolean; restoredFromTrash: false };

export async function persistOriginalFileCapture(database: Database, storage: OriginalFileStorage, file: ReceivedOriginalFile, classification: OriginalFileClassification): Promise<PersistedOriginalFileCapture> {
    const providerIdentity = `sha256:${file.contentHash}`;
    const intent = await database.transaction(async transaction => {
        await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${file.contentHash}, 0))`);
        const existing = (await transaction.select({ originalFile: originalFiles }).from(originalFiles).where(eq(originalFiles.contentHash, file.contentHash)))[0]?.originalFile;
        if (existing) return { sourceId: existing.sourceId, existing: true, stored: existing.storageState === "stored" };
        const [source] = await transaction.insert(sources).values({ provenanceKind: "original-file", sourceKind: classification.sourceKind }).returning();
        if (!source) throw new Error("Original File Source was not created");
        await transaction.insert(originalFiles).values({ sourceId: source.id, contentHash: file.contentHash, byteSize: file.byteSize, detectedMediaType: classification.mediaType, detectedSourceKind: classification.sourceKind, storageProvider: storage.provider, providerIdentity, storageState: "pending-upload" });
        await transaction.insert(originalFileOperations).values({ originalFileSourceId: source.id, kind: "upload" });
        return { sourceId: source.id, existing: false, stored: false };
    });

    if (intent.stored) return createCapture(database, intent.sourceId, file, true);
    try {
        const stored = await storage.upload({ localPath: file.localPath, providerIdentity, mediaType: classification.mediaType });
        return await database.transaction(async transaction => {
            await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${file.contentHash}, 0))`);
            await transaction.update(originalFiles).set({ storageLocator: stored.locator, storageState: "stored" }).where(eq(originalFiles.sourceId, intent.sourceId));
            await transaction.update(originalFileOperations).set({ status: "completed" }).where(eq(originalFileOperations.originalFileSourceId, intent.sourceId));
            return createCapture(transaction, intent.sourceId, file, intent.existing || stored.reused);
        });
    } catch (error) {
        if (!intent.existing && error instanceof OriginalFileStorageError && error.kind !== "ambiguous") {
            await database.delete(sources).where(eq(sources.id, intent.sourceId));
        }
        throw error;
    }
}

async function createCapture(database: Database, sourceId: number, file: ReceivedOriginalFile, reused: boolean): Promise<PersistedOriginalFileCapture> {
    const knowledgeItem = (await database.select().from(knowledgeItems).where(eq(knowledgeItems.sourceId, sourceId)))[0]
        ?? (await database.insert(knowledgeItems).values({ sourceId }).returning())[0];
    if (!knowledgeItem) throw new Error("Knowledge Item was not created");
    const [capture] = await database.insert(captures).values({ sourceId, knowledgeItemId: knowledgeItem.id, submittedFilename: file.filename }).returning();
    if (!capture) throw new Error("Capture was not created");
    if (file.personalNote) await database.insert(captureContexts).values({ captureId: capture.id, kind: "personal-note", text: file.personalNote });
    return { captureId: capture.id, sourceId, knowledgeItemId: knowledgeItem.id, processingAttemptId: null, reused, restoredFromTrash: false };
}

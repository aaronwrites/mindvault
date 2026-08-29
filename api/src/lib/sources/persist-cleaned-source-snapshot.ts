import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";
import { extractedSources, processingAttempts, sourcePreviews, sourceSnapshots, sources } from "../../db/schema";
import type { ExtractedSourcePreview } from "./extract-source-preview";
import type { SafeFetchOptions } from "./fetch-public-source";
import { retainSourcePreviewMedia } from "./retain-source-preview-media";
import type { ClaimedProcessingStage } from "../../worker";

type Database = NodePgDatabase<typeof schema>;

export function createSnapshotPersistenceStageHandler(database: Database, sourceFetchOptions: SafeFetchOptions = {}) {
    return async (stage: ClaimedProcessingStage): Promise<void> => {
        const [extractedSource] = await database.select()
            .from(extractedSources)
            .where(eq(extractedSources.processingAttemptId, stage.processingAttemptId));
        if (!extractedSource) throw new Error("Source Snapshot persistence could not find successful Extraction output");

        const contentHash = contentHashFor(extractedSource.primaryText);
        const { snapshotId, preview } = await database.transaction(async transaction => {
            await transaction.insert(sourceSnapshots).values({
                sourceId: extractedSource.sourceId,
                title: extractedSource.title,
                primaryText: extractedSource.primaryText,
                originalUrl: extractedSource.originalUrl,
                finalUrl: extractedSource.finalUrl,
                canonicalUrl: extractedSource.canonicalUrl,
                permanentRedirects: extractedSource.permanentRedirects,
                extractedAt: extractedSource.extractedAt,
                contentHash,
            }).onConflictDoNothing({
                target: [sourceSnapshots.sourceId, sourceSnapshots.contentHash],
            });
            const [snapshot] = await transaction.select({ id: sourceSnapshots.id })
                .from(sourceSnapshots)
                .where(and(
                    eq(sourceSnapshots.sourceId, extractedSource.sourceId),
                    eq(sourceSnapshots.contentHash, contentHash),
                ));
            if (!snapshot) throw new Error("Source Snapshot persistence could not identify the stored snapshot");

            const preview = extractedSource.sourcePreview as ExtractedSourcePreview;
            await transaction.insert(sourcePreviews).values({
                sourceSnapshotId: snapshot.id,
                title: preview.title,
                description: preview.description,
                websiteName: preview.websiteName,
                author: preview.author,
                publishedAt: preview.publishedAt ? new Date(preview.publishedAt) : null,
                contentType: preview.contentType,
                previewImageUrl: preview.previewImageUrl,
                previewImageAlt: preview.previewImageAlt,
                faviconUrl: preview.faviconUrl,
            }).onConflictDoNothing();

            await transaction.update(sources).set({ currentSnapshotId: snapshot.id })
                .where(eq(sources.id, extractedSource.sourceId));
            await transaction.update(processingAttempts).set({ sourceSnapshotId: snapshot.id })
                .where(eq(processingAttempts.id, stage.processingAttemptId));
            return { snapshotId: snapshot.id, preview };
        });

        try {
            await retainSourcePreviewMedia(database, snapshotId, preview, sourceFetchOptions);
        } catch {
            // Preview media is optional presentation enrichment and must never fail Extraction.
        }
    };
}

export function contentHashFor(primaryText: string): string {
    return createHash("sha256").update(primaryText, "utf8").digest("hex");
}

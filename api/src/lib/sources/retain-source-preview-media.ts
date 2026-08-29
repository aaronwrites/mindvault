import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";
import { sourcePreviewMedia } from "../../db/schema";
import { fetchPublicPreviewMedia, type SafeFetchOptions } from "./fetch-public-source";
import type { ExtractedSourcePreview } from "./extract-source-preview";

type Database = NodePgDatabase<typeof schema>;

export async function retainSourcePreviewMedia(
    database: Database,
    sourceSnapshotId: number,
    preview: ExtractedSourcePreview,
    fetchOptions: SafeFetchOptions,
): Promise<void> {
    const candidates = [
        { url: preview.previewImageUrl, alternativeText: preview.previewImageAlt },
        { url: preview.faviconUrl, alternativeText: null },
    ].filter((candidate): candidate is { url: string; alternativeText: string | null } => candidate.url !== null);
    for (const candidate of candidates) {
        const fetched = await fetchPublicPreviewMedia(candidate.url, fetchOptions);
        if (!fetched.ok) continue;

        await database.insert(sourcePreviewMedia).values({
            sourceSnapshotId,
            sourceUrl: fetched.response.finalUrl,
            contentType: fetched.response.contentType,
            alternativeText: candidate.alternativeText,
            bytes: Buffer.from(fetched.response.body),
        }).onConflictDoNothing();
        return;
    }
}

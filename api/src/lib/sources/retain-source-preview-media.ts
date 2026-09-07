import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import sharp from "sharp";
import * as schema from "../../db/schema";
import { sourcePreviewMedia } from "../../db/schema";
import { fetchPublicPreviewMedia, type SafeFetchOptions } from "./fetch-public-source";
import type { ExtractedSourcePreview } from "./extract-source-preview";

type Database = NodePgDatabase<typeof schema>;

const maximumRetainedPreviewBytes = 2_097_152;

export async function retainSourcePreviewMedia(
    database: Database,
    sourceSnapshotId: number,
    preview: ExtractedSourcePreview,
    fetchOptions: SafeFetchOptions,
): Promise<void> {
    const candidates: Array<{ url: string | null; alternativeText: string | null; presentation: "cover" | "icon" }> = [
        { url: preview.previewImageUrl, alternativeText: preview.previewImageAlt, presentation: "cover" as const },
        { url: preview.faviconUrl, alternativeText: "Website icon", presentation: "icon" as const },
        ...(preview.faviconFallbackUrl && preview.faviconFallbackUrl !== preview.faviconUrl
            ? [{ url: preview.faviconFallbackUrl, alternativeText: "Website icon", presentation: "icon" as const }]
            : []),
    ];
    for (const candidate of candidates) {
        if (!candidate.url) continue;
        const fetched = await fetchPublicPreviewMedia(candidate.url, fetchOptions);
        if (!fetched.ok) continue;

        const retained = await prepareRetainedPreviewMedia(
            fetched.response.body,
            fetched.response.contentType,
            maximumRetainedPreviewBytes,
        );
        if (!retained) continue;

        await database.insert(sourcePreviewMedia).values({
            sourceSnapshotId,
            sourceUrl: fetched.response.finalUrl,
            contentType: retained.contentType,
            presentation: candidate.presentation,
            alternativeText: candidate.alternativeText,
            bytes: retained.bytes,
        }).onConflictDoNothing();
        return;
    }
}

/**
 * Keep small validated originals byte-for-byte, including animated GIF/WebP.
 * Larger images become inert, bounded WebP thumbnails. Sharp decodes only the
 * first page/frame and enforces a pixel limit to resist decompression bombs.
 */
export async function prepareRetainedPreviewMedia(
    body: Uint8Array,
    contentType: string,
    maximumBytes = maximumRetainedPreviewBytes,
): Promise<{ bytes: Buffer; contentType: string } | null> {
    if (body.byteLength <= maximumBytes) return { bytes: Buffer.from(body), contentType };
    try {
        let width = 1600;
        let quality = 84;
        for (let attempt = 0; attempt < 4; attempt += 1) {
            const bytes = await sharp(body, { animated: false, limitInputPixels: 40_000_000 })
                .rotate()
                .resize({ width, height: 1200, fit: "inside", withoutEnlargement: true })
                .webp({ quality })
                .toBuffer();
            if (bytes.byteLength <= maximumBytes) return { bytes, contentType: "image/webp" };
            width = Math.floor(width * 0.7);
            quality -= 12;
        }
        return null;
    } catch {
        return null;
    }
}

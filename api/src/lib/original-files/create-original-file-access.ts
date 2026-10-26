import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";
import { captures, knowledgeItems, originalFiles } from "../../db/schema";
import { OriginalFileStorageError, type OriginalFileStorage } from "./original-file-storage";

type Database = NodePgDatabase<typeof schema>;
type AccessAction = "open" | "download";

const accessLifetimeMilliseconds = 5 * 60 * 1_000;
const browserSafeImageTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export async function createOriginalFileAccess(database: Database, storage: () => OriginalFileStorage, knowledgeItemId: number, action: AccessAction, page?: number) {
    const record = (await database
        .select({ knowledgeItem: knowledgeItems, originalFile: originalFiles, filename: captures.submittedFilename })
        .from(knowledgeItems)
        .innerJoin(originalFiles, eq(originalFiles.sourceId, knowledgeItems.sourceId))
        .leftJoin(captures, and(eq(captures.knowledgeItemId, knowledgeItems.id), eq(captures.sourceId, knowledgeItems.sourceId)))
        .where(eq(knowledgeItems.id, knowledgeItemId))
        .orderBy(captures.id)
    ).at(-1);

    if (!record || record.knowledgeItem.lifecycleState === "pending-permanent-deletion" || record.originalFile.storageState !== "stored" || !record.originalFile.storageLocator) {
        return { outcome: "unavailable" as const };
    }
    if (action === "open" && !isBrowserSafe(record.originalFile.detectedSourceKind, record.originalFile.detectedMediaType)) {
        return { outcome: "open-not-available" as const };
    }

    if (page !== undefined && record.originalFile.detectedSourceKind !== "pdf") return { outcome: "unavailable" as const };

    try {
        const originalFileStorage = storage();
        if (record.originalFile.storageProvider !== originalFileStorage.provider) return { outcome: "unavailable" as const };
        const expiresAt = new Date(Date.now() + accessLifetimeMilliseconds);
        const access = await originalFileStorage.createSignedAccess({
            locator: record.originalFile.storageLocator,
            expiresAt,
            disposition: action === "open" ? "inline" : "attachment",
            filename: safeDeliveryFilename(record.filename, record.originalFile.detectedSourceKind),
        });
        if (page !== undefined) {
            const destination = new URL(access.url);
            destination.hash = `page=${page}`;
            access.url = destination.toString();
        }
        return { outcome: "ready" as const, access };
    } catch (error) {
        if (error instanceof OriginalFileStorageError && (error.kind === "unavailable" || error.kind === "configuration")) return { outcome: "provider-unavailable" as const };
        return { outcome: "unavailable" as const };
    }
}

export function originalFileActions(knowledgeItemId: number, storageState: string, sourceKind: string, mediaType: string) {
    if (storageState !== "stored") return undefined;
    return {
        download: `/knowledge-items/${knowledgeItemId}/original-file/download`,
        ...(isBrowserSafe(sourceKind, mediaType) ? { open: `/knowledge-items/${knowledgeItemId}/original-file/open` } : {}),
    };
}

function isBrowserSafe(sourceKind: string, mediaType: string) {
    return sourceKind === "pdf" || sourceKind === "plain-text" || browserSafeImageTypes.has(mediaType);
}

export function safeDeliveryFilename(submittedFilename: string | null, sourceKind: string) {
    const leaf = (submittedFilename ?? "").split(/[\\/]/).at(-1) ?? "";
    const safe = leaf
        .normalize("NFKC")
        .replace(/[\p{C}]/gu, "")
        .replace(/[^\p{L}\p{N}._() -]/gu, "-")
        .replace(/\s+/g, " ")
        .replace(/^[. ]+|[. ]+$/g, "");
    return safe || fallbackFilename(sourceKind);
}

function fallbackFilename(sourceKind: string) {
    const extension = ({ pdf: "pdf", image: "image", "word-document": "docx", markdown: "md", "plain-text": "txt", audio: "audio", video: "video", file: "file" } as Record<string, string>)[sourceKind] ?? "file";
    return `original-file.${extension}`;
}

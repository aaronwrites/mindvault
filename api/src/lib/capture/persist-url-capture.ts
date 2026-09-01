import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import * as schema from "../../db/schema";
import type { CaptureContextKind } from "../../db/schema";
import {
    captureContexts,
    captures,
    knowledgeItems,
    sources,
    webpageSources,
} from "../../db/schema";
import type { CreateCaptureInput } from "../../schemas/capture";
import { normalizeCaptureUrl } from "./normalize-capture-url";
import { createProcessingAttempt } from "../processing/create-processing-attempt";
import { hasRecentSuccessfulExtraction } from "./refresh-policy";

export type PersistedCapture = {
    captureId: number;
    sourceId: number;
    knowledgeItemId: number;
    processingAttemptId: number | null;
};

export async function persistUrlCapture(
    database: NodePgDatabase<typeof schema>,
    input: CreateCaptureInput,
): Promise<PersistedCapture> {
    return database.transaction(async transaction => {
        const normalizedUrl = normalizeCaptureUrl(input.url);
        await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${normalizedUrl}, 0))`);
        const existingSource = (await transaction
            .select({ source: sources })
            .from(webpageSources)
            .innerJoin(sources, eq(sources.id, webpageSources.sourceId))
            .where(eq(webpageSources.normalizedUrl, normalizedUrl)))[0]?.source;
        const [createdSource] = existingSource ? [] : await transaction.insert(sources).values({
            provenanceKind: "webpage",
            sourceKind: "web",
        }).returning();
        if (createdSource) {
            await transaction.insert(webpageSources).values({
                sourceId: createdSource.id,
                submittedUrl: input.url,
                normalizedUrl,
            });
        }
        const source = createdSource ?? existingSource;
        if (!source) throw new Error("Source was not created");

        const knowledgeItem = createdSource
            ? (await transaction.insert(knowledgeItems).values({ sourceId: source.id }).returning())[0]
            : (await transaction.select().from(knowledgeItems).where(eq(knowledgeItems.sourceId, source.id)))[0];
        if (!knowledgeItem) throw new Error("Knowledge Item was not created");

        const [capture] = await transaction.insert(captures).values({
            sourceId: source.id,
            knowledgeItemId: knowledgeItem.id,
        }).returning();
        if (!capture) throw new Error("Capture was not created");

        const contexts = [
            input.selectedText && { captureId: capture.id, kind: "selected-source-text", text: input.selectedText },
            input.personalNote && { captureId: capture.id, kind: "personal-note", text: input.personalNote },
        ].filter((context): context is { captureId: number; kind: CaptureContextKind; text: string } => Boolean(context));
        if (contexts.length > 0) await transaction.insert(captureContexts).values(contexts);

        const processingAttemptId = createdSource || !await hasRecentSuccessfulExtraction(transaction, source.id)
            ? await createProcessingAttempt(transaction, knowledgeItem.id, createdSource ? "initial-capture" : "refresh")
            : null;

        return {
            captureId: capture.id,
            sourceId: source.id,
            knowledgeItemId: knowledgeItem.id,
            processingAttemptId,
        };
    });
}

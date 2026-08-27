import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";
import type { CaptureContextKind } from "../../db/schema";
import {
    captureContexts,
    captures,
    knowledgeItems,
    sources,
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
        const [createdSource] = await transaction.insert(sources).values({
            submittedUrl: input.url,
            normalizedUrl,
        }).onConflictDoNothing().returning();
        const source = createdSource ?? (await transaction
            .select()
            .from(sources)
            .where(eq(sources.normalizedUrl, normalizedUrl)))[0];
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

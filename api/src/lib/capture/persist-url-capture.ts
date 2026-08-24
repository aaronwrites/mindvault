import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";
import {
    captureContexts,
    captures,
    knowledgeItems,
    processingAttempts,
    processingStages,
    sources,
} from "../../db/schema";
import type { CreateCaptureInput } from "../../schemas/capture";
import { normalizeCaptureUrl } from "./normalize-capture-url";
import { processingStageKinds, type ProcessingStageKind } from "../processing/stages";

export type PersistedCapture = {
    captureId: number;
    sourceId: number;
    knowledgeItemId: number;
    processingAttemptId: number;
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
        ].filter((context): context is { captureId: number; kind: string; text: string } => Boolean(context));
        if (contexts.length > 0) await transaction.insert(captureContexts).values(contexts);

        const [attempt] = await transaction.insert(processingAttempts).values({
            knowledgeItemId: knowledgeItem.id,
            kind: createdSource ? "initial-capture" : "refresh",
        }).returning();
        if (!attempt) throw new Error("Processing Attempt was not created");

        const stages = new Map<string, number>();
        for (const kind of processingStageKinds) {
            const prerequisite = prerequisiteFor(kind);
            const prerequisiteStageId = prerequisite ? stages.get(prerequisite) : undefined;
            const [stage] = await transaction.insert(processingStages).values({
                processingAttemptId: attempt.id,
                kind,
                prerequisiteStageId,
            }).returning();
            if (!stage) throw new Error(`Processing stage ${kind} was not created`);
            stages.set(kind, stage.id);
        }

        return {
            captureId: capture.id,
            sourceId: source.id,
            knowledgeItemId: knowledgeItem.id,
            processingAttemptId: attempt.id,
        };
    });
}

function prerequisiteFor(kind: ProcessingStageKind): ProcessingStageKind | undefined {
    switch (kind) {
        case "snapshot-persistence":
            return "extraction";
        case "passage-generation":
        case "recognition-summary-generation":
        case "topic-tag-generation":
            return "snapshot-persistence";
        case "lexical-indexing":
        case "semantic-indexing":
            return "passage-generation";
        default:
            return undefined;
    }
}

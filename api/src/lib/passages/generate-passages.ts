import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";
import { captureContextKinds, captureContexts, captures, knowledgeItems, passages, processingAttempts, sourceSnapshots, sources, type CaptureContextKind } from "../../db/schema";
import type { ClaimedProcessingStage } from "../../worker";
import { createPassageTexts } from "./create-passages";

type Database = NodePgDatabase<typeof schema>;

export function createPassageGenerationStageHandler(database: Database) {
    return async (stage: ClaimedProcessingStage): Promise<void> => {
        const [attempt] = await database.select({
            knowledgeItemId: processingAttempts.knowledgeItemId,
            sourceSnapshotId: processingAttempts.sourceSnapshotId,
        }).from(processingAttempts)
            .innerJoin(knowledgeItems, eq(knowledgeItems.id, processingAttempts.knowledgeItemId))
            .innerJoin(sources, eq(sources.id, knowledgeItems.sourceId))
            .where(eq(processingAttempts.id, stage.processingAttemptId));
        if (!attempt?.sourceSnapshotId) throw new Error("Passage generation could not find the Source Snapshot produced by this Processing Attempt");

        const [snapshot] = await database.select({ id: sourceSnapshots.id, evidenceText: sourceSnapshots.evidenceText, pdfEvidence: sourceSnapshots.pdfEvidence })
            .from(sourceSnapshots)
            .where(eq(sourceSnapshots.id, attempt.sourceSnapshotId));
        if (!snapshot) throw new Error("Passage generation could not find the Source Snapshot content");

        const contexts = await database.select({ id: captureContexts.id, kind: captureContexts.kind, text: captureContexts.text })
            .from(captureContexts)
            .innerJoin(captures, eq(captures.id, captureContexts.captureId))
            .where(eq(captures.knowledgeItemId, attempt.knowledgeItemId))
            .orderBy(captureContexts.id);

        const generatedPassages = [
            ...(snapshot.pdfEvidence
                ? snapshot.pdfEvidence.pages.flatMap(page => createPassageTexts(page.text).map(text => ({ text, pageNumber: page.pageNumber })))
                    .map((passage, ordinal) => ({ ...passage, ordinal, sourceSnapshotId: snapshot.id, captureContextId: null, origin: "source-snapshot" }))
                : passagesForSourceSnapshot(snapshot.id, snapshot.evidenceText)),
            ...contexts.flatMap(context => passagesForCaptureContext(context.id, captureContextKindFor(context.kind), context.text)),
        ];
        if (generatedPassages.length === 0) return;

        await database.insert(passages).values(generatedPassages).onConflictDoNothing();
    };
}

function passagesForSourceSnapshot(sourceSnapshotId: number, text: string) {
    return createPassageTexts(text).map((passageText, ordinal) => ({
        sourceSnapshotId,
        captureContextId: null,
        origin: "source-snapshot",
        text: passageText,
        ordinal,
    }));
}

function passagesForCaptureContext(captureContextId: number, origin: CaptureContextKind, text: string) {
    return createPassageTexts(text).map((passageText, ordinal) => ({
        sourceSnapshotId: null,
        captureContextId,
        origin,
        text: passageText,
        ordinal,
    }));
}

function captureContextKindFor(kind: string): CaptureContextKind {
    if ((captureContextKinds as readonly string[]).includes(kind)) return kind as CaptureContextKind;
    throw new Error("Passage generation found an unknown Capture Context kind");
}

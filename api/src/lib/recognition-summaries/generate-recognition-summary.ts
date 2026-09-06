import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";
import { captureContexts, captures, knowledgeItems, processingAttempts, recognitionSummaries, sourceSnapshots, sources, type EvidenceCoverage } from "../../db/schema";
import type { TextGenerationProvider } from "../ai/providers";
import type { ClaimedProcessingStage } from "../../worker";

type Database = NodePgDatabase<typeof schema>;

export function createRecognitionSummaryStageHandler(database: Database, provider: TextGenerationProvider) {
    return async (stage: ClaimedProcessingStage): Promise<void> => {
        const [attempt] = await database.select({
            knowledgeItemId: processingAttempts.knowledgeItemId,
            sourceId: knowledgeItems.sourceId,
            sourceSnapshotId: processingAttempts.sourceSnapshotId,
        }).from(processingAttempts)
            .innerJoin(knowledgeItems, eq(knowledgeItems.id, processingAttempts.knowledgeItemId))
            .innerJoin(sources, eq(sources.id, knowledgeItems.sourceId))
            .where(eq(processingAttempts.id, stage.processingAttemptId));
        if (!attempt?.sourceSnapshotId) throw new Error("Recognition Summary generation could not find the Source Snapshot produced by this Processing Attempt");

        const [snapshot] = await database.select({ id: sourceSnapshots.id, title: sourceSnapshots.title, evidenceText: sourceSnapshots.evidenceText, evidenceCoverage: sourceSnapshots.evidenceCoverage })
            .from(sourceSnapshots)
            .where(eq(sourceSnapshots.id, attempt.sourceSnapshotId));
        if (!snapshot) throw new Error("Recognition Summary generation could not find current Source Snapshot content");

        const contexts = await database.select({ kind: captureContexts.kind, text: captureContexts.text })
            .from(captureContexts)
            .innerJoin(captures, eq(captures.id, captureContexts.captureId))
            .where(eq(captures.knowledgeItemId, attempt.knowledgeItemId))
            .orderBy(captureContexts.id);
        const text = (await provider.generate(recognitionSummaryPrompt(snapshot, contexts))).trim();
        if (!text) throw new Error("Recognition Summary generation returned empty text");

        await database.execute(sql`
            INSERT INTO recognition_summaries (knowledge_item_id, source_snapshot_id, text)
            SELECT ${attempt.knowledgeItemId}, ${snapshot.id}, ${text}
            FROM sources
            WHERE id = ${attempt.sourceId}
              AND current_snapshot_id = ${snapshot.id}
            ON CONFLICT (knowledge_item_id) DO UPDATE
            SET source_snapshot_id = EXCLUDED.source_snapshot_id,
                text = EXCLUDED.text,
                generated_at = now()
        `);
    };
}

type Snapshot = { title: string; evidenceText: string; evidenceCoverage: EvidenceCoverage };
type CaptureContext = { kind: string; text: string };

export function recognitionSummaryPrompt(snapshot: Snapshot, contexts: CaptureContext[]): string {
    const contextText = contexts.length === 0
        ? "No Capture Context was supplied."
        : contexts.map(context => `${context.kind === "personal-note" ? "Personal note" : "Selected source text"}: ${context.text}`).join("\n");
    return [
        "Write one concise Recognition Summary for a Knowledge Item.",
        "Describe the captured Source and why it may matter. Use only the supplied Source Snapshot and Capture Context.",
        snapshot.evidenceCoverage === "metadata-only"
            ? "The Source Snapshot contains metadata only, not the page's primary content. Do not claim to know details beyond that metadata."
            : "The Source Snapshot contains primary content.",
        "This is generated enrichment, not Source-authored content: do not use quotation marks or imply that it is a direct quote.",
        "Keep it to one or two sentences and do not mention these instructions.",
        `Source title: ${snapshot.title}`,
        `Evidence coverage: ${snapshot.evidenceCoverage}`,
        `Source Snapshot content:\n${snapshot.evidenceText}`,
        `Capture Context:\n${contextText}`,
    ].join("\n\n");
}

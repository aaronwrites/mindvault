import { and, eq, ne } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";
import { extractedSources, knowledgeItems, processingAttempts, processingStages, sources, webpageSources } from "../../db/schema";
import { classifySourceSupport } from "./classify-source-support";
import { fetchPublicSource, type SafeFetchOptions } from "./fetch-public-source";
import { reconcileExtractedSourceIdentity } from "./reconcile-source-identity";
import { parsePublicTextualSource } from "./extract-source-preview";
import { completeCurrentStage, withCurrentLease } from "../processing/current-stage-lease";
import type { ClaimedProcessingStage } from "../../worker";

type Database = NodePgDatabase<typeof schema>;

export function createExtractionStageHandler(database: Database, fetchOptions: SafeFetchOptions = {}) {
    return async (stage: ClaimedProcessingStage): Promise<void | { completed: true }> => {
        const source = await sourceForAttempt(database, stage.processingAttemptId);
        if (!source) throw new Error("Extraction could not find its Source");

        const fetched = await fetchPublicSource(source.submittedUrl, fetchOptions);
        const support = classifySourceSupport(fetched);
        if (support?.kind === "unsupported") {
            const completed = await withCurrentLease(database, stage, async transaction => {
                await transaction.update(sources).set({ sourceKind: support.sourceKind }).where(eq(sources.id, source.id));
                await transaction.update(processingAttempts).set({ status: "unsupported", failureReason: null })
                    .where(eq(processingAttempts.id, stage.processingAttemptId));
                await transaction.update(processingStages).set({ status: "skipped" })
                    .where(and(
                        eq(processingStages.processingAttemptId, stage.processingAttemptId),
                        ne(processingStages.id, stage.id),
                    ));
                await completeCurrentStage(transaction, stage);
                return true;
            });
            return completed ? { completed: true } : undefined;
        }
        if (!fetched.ok) throw new Error(failureReasonForFetch(fetched.failure));
        if (!support || support.kind !== "supported") throw new Error("MindVault could not determine how to process this Source");

        const extracted = parsePublicTextualSource(new TextDecoder().decode(fetched.response.body), fetched.response.finalUrl);
        const completed = await withCurrentLease(database, stage, async transaction => {
            const reconciledSource = await reconcileExtractedSourceIdentity(transaction, source, {
                canonicalUrl: extracted.canonicalUrl,
                permanentRedirects: fetched.permanentRedirects,
            });
            await transaction.update(sources).set({ sourceKind: support.sourceKind }).where(eq(sources.id, reconciledSource.id));
            await transaction.insert(extractedSources).values({
                processingAttemptId: stage.processingAttemptId,
                sourceId: reconciledSource.id,
                title: extracted.title,
                evidenceText: extracted.evidenceText,
                evidenceCoverage: extracted.evidenceCoverage,
                originalUrl: fetched.response.originalUrl,
                finalUrl: fetched.response.finalUrl,
                canonicalUrl: extracted.canonicalUrl,
                permanentRedirects: fetched.permanentRedirects,
                sourcePreview: extracted.sourcePreview,
            }).onConflictDoUpdate({
                target: extractedSources.processingAttemptId,
                set: {
                    title: extracted.title,
                    evidenceText: extracted.evidenceText,
                    evidenceCoverage: extracted.evidenceCoverage,
                    originalUrl: fetched.response.originalUrl,
                    finalUrl: fetched.response.finalUrl,
                    canonicalUrl: extracted.canonicalUrl,
                    permanentRedirects: fetched.permanentRedirects,
                    sourcePreview: extracted.sourcePreview,
                    extractedAt: new Date(),
                },
            });
            if (!extracted.failureReason) await completeCurrentStage(transaction, stage);
            return true;
        });
        if (extracted.failureReason) throw new Error(extracted.failureReason);
        return completed ? { completed: true } : undefined;
    };
}

async function sourceForAttempt(database: Database, processingAttemptId: number) {
    const [row] = await database.select({ id: sources.id, submittedUrl: webpageSources.submittedUrl })
        .from(processingAttempts)
        .innerJoin(knowledgeItems, eq(knowledgeItems.id, processingAttempts.knowledgeItemId))
        .innerJoin(sources, eq(sources.id, knowledgeItems.sourceId))
        .innerJoin(webpageSources, eq(webpageSources.sourceId, sources.id))
        .where(eq(processingAttempts.id, processingAttemptId));
    return row;
}

function failureReasonForFetch(failure: { kind: string; status?: number }): string {
    if (failure.kind === "http-status") return `The Source returned HTTP ${failure.status}`;
    if (failure.kind === "timeout") return "Fetching this Source timed out";
    if (failure.kind === "unsafe-network-target") return "This Source resolves to an unsafe network target";
    return "MindVault could not fetch this Source safely";
}

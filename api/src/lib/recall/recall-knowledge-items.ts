import { pdfExtractionCoverage, type PdfExtractionCoverage } from "../pdf/pdf-extraction-disclosure";
import { and, eq, inArray, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";
import { captureContexts, captures, knowledgeItems, passages, sourceSnapshots, sources, type EvidenceCoverage } from "../../db/schema";
import type { EmbeddingProvider } from "../ai/providers";
import { getKnowledgeItem, type KnowledgeItemView } from "../knowledge-items/read-knowledge-items";
import { findLexicalPassages } from "../passages/find-lexical-passages";
import { findSemanticPassages } from "../passages/find-semantic-passages";
import { aggregateHybridPassageMatches, type RankedPassageInput } from "./hybrid-passage-ranking";

type Database = NodePgDatabase<typeof schema>;
const SEMANTIC_MATCH_DISTANCE_THRESHOLD = 0.4;

export type RecallKnowledgeItemResult = {
    id: number;
    title: string | null;
    source: KnowledgeItemView["source"];
    sourcePreview: KnowledgeItemView["sourcePreview"];
    recognitionSummary: string | null;
    topicTags: string[];
    excerpts: Array<{
        text: string;
        pageNumber: number | null;
        pageLabel: string | null;
        openOriginalFile?: string;
        origin: "source-snapshot" | "selected-source-text" | "personal-note";
        sourceSnapshot: {
            id: number;
            title: string;
            originalUrl: string | null;
            finalUrl: string | null;
            canonicalUrl: string | null;
            extractedAt: string;
            evidenceCoverage: EvidenceCoverage;
            extractionCoverage?: PdfExtractionCoverage;
        } | null;
        ranking: { score: number; semanticRank?: number; lexicalRank?: number };
    }>;
    ranking: { score: number; matchedPassageCount: number };
};

export async function recallKnowledgeItems(database: Database, query: string, embeddingProvider: EmbeddingProvider): Promise<RecallKnowledgeItemResult[]> {
    const [semanticCandidates, lexicalMatches] = await Promise.all([
        findSemanticPassages(database, query, embeddingProvider),
        findLexicalPassages(database, query),
    ]);
    const semanticMatches = semanticCandidates.filter(match => match.distance <= SEMANTIC_MATCH_DISTANCE_THRESHOLD);
    const passageIds = [...new Set([...semanticMatches.map(match => match.passageId), ...lexicalMatches.map(match => match.id)])];
    if (passageIds.length === 0) return [];

    const passageRows = await database
        .select({
            pageNumber: passages.pageNumber, passageId: passages.id, origin: passages.origin, text: passages.text, knowledgeItemId: knowledgeItems.id,
            sourceSnapshotId: sourceSnapshots.id, sourceSnapshotTitle: sourceSnapshots.title,
            originalUrl: sourceSnapshots.originalUrl, finalUrl: sourceSnapshots.finalUrl,
            canonicalUrl: sourceSnapshots.canonicalUrl, extractedAt: sourceSnapshots.extractedAt,
            evidenceCoverage: sourceSnapshots.evidenceCoverage,
            pdfEvidence: sourceSnapshots.pdfEvidence,
        })
        .from(passages)
        .leftJoin(sourceSnapshots, eq(passages.sourceSnapshotId, sourceSnapshots.id))
        .leftJoin(captureContexts, eq(passages.captureContextId, captureContexts.id))
        .leftJoin(captures, eq(captureContexts.captureId, captures.id))
        .innerJoin(knowledgeItems, or(eq(knowledgeItems.sourceId, sourceSnapshots.sourceId), eq(knowledgeItems.id, captures.knowledgeItemId)))
        .innerJoin(sources, eq(knowledgeItems.sourceId, sources.id))
        .where(and(inArray(passages.id, passageIds), eq(knowledgeItems.lifecycleState, "active")));

    const detailsByPassageId = new Map(passageRows.map(row => [row.passageId, row]));
    const hybridMatches = aggregateHybridPassageMatches({
        semantic: semanticMatches.flatMap((match, index) => toRankedInput(detailsByPassageId.get(match.passageId), match.passageId, index + 1)),
        lexical: lexicalMatches.flatMap((match, index) => toRankedInput(detailsByPassageId.get(match.id), match.id, index + 1)),
    });
    const views = await Promise.all(hybridMatches.map(match => getKnowledgeItem(database, match.knowledgeItemId, embeddingProvider.representation)));
    const viewsById = new Map(views.filter((view): view is KnowledgeItemView => view !== undefined).map(view => [view.id, view]));

    return hybridMatches.flatMap(match => {
        const view = viewsById.get(match.knowledgeItemId);
        if (!view || view.availability !== "ready") return [];
        return [{
            id: view.id,
            title: view.title,
            source: view.source,
            sourcePreview: view.sourcePreview,
            recognitionSummary: view.recognitionSummary,
            topicTags: view.topicTags,
            excerpts: match.passages.slice(0, 3).flatMap(passage => {
                const details = detailsByPassageId.get(passage.passageId);
                if (!details) return [];
                return [{
                    text: passage.text,
                    pageNumber: details.pageNumber,
                    pageLabel: details.pdfEvidence?.pages.find(page => page.pageNumber === details.pageNumber)?.pageLabel ?? null,
                    ...(details.pageNumber && view.source.originalFileActions?.open ? { openOriginalFile: `${view.source.originalFileActions.open}?page=${details.pageNumber}` } : {}),
                    origin: passage.origin,
                    sourceSnapshot: details.sourceSnapshotId === null ? null : {
                        id: details.sourceSnapshotId, title: details.sourceSnapshotTitle!, originalUrl: details.originalUrl, finalUrl: details.finalUrl,
                        canonicalUrl: details.canonicalUrl, extractedAt: toIsoString(details.extractedAt!),
                        evidenceCoverage: details.evidenceCoverage!,
                        ...(details.pdfEvidence ? { extractionCoverage: pdfExtractionCoverage(details.pdfEvidence) } : {}),
                    },
                    ranking: {
                        score: passage.score,
                        ...(passage.semanticRank === undefined ? {} : { semanticRank: passage.semanticRank }),
                        ...(passage.lexicalRank === undefined ? {} : { lexicalRank: passage.lexicalRank }),
                    },
                }];
            }),
            ranking: { score: match.score, matchedPassageCount: match.passages.length },
        }];
    });
}

function toRankedInput(details: { origin: string; text: string; knowledgeItemId: number } | undefined, passageId: number, rank: number): RankedPassageInput[] {
    if (!details) return [];
    return [{ passageId, knowledgeItemId: details.knowledgeItemId, origin: details.origin as RankedPassageInput["origin"], text: details.text, rank }];
}

function toIsoString(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : value;
}

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";
import type { EmbeddingProvider, SynthesisConversationTurn, SynthesisEvidence, SynthesisGenerationProvider } from "../ai/providers";
import { recallKnowledgeItems } from "../recall/recall-knowledge-items";

type Database = NodePgDatabase<typeof schema>;

const maximumEvidenceItems = 8;
const maximumEvidenceCharacters = 12_000;
const maximumExcerptCharacters = 1_500;

export type SynthesisResult = {
    answer: string;
    citations: Array<{
        knowledgeItemId: number;
        sourceSnapshotId: number | null;
        title: string;
        originalUrl: string;
        evidenceCoverage: SynthesisEvidence["evidenceCoverage"];
        excerpt: string;
    }>;
    insufficientEvidence: boolean;
};

export async function synthesizeKnowledge(
    database: Database,
    question: string,
    conversation: SynthesisConversationTurn[],
    embeddingProvider: EmbeddingProvider,
    generationProvider: SynthesisGenerationProvider,
): Promise<SynthesisResult> {
    const recalled = await recallKnowledgeItems(database, retrievalQueryFor(question, conversation), embeddingProvider);
    const evidence = evidenceFor(recalled);
    if (evidence.length === 0) {
        return {
            answer: "I don't have enough captured evidence to answer that question.",
            citations: [],
            insufficientEvidence: true,
        };
    }

    const generated = await generationProvider.generateSynthesis({ question, evidence, conversation });
    if (generated.insufficientEvidence) {
        return { answer: generated.answer, citations: [], insufficientEvidence: true };
    }
    const evidenceByCitationId = new Map(evidence.map(item => [item.citationId, item]));
    const citedEvidence = [...new Set(generated.citationIds)].flatMap(citationId => {
        const item = evidenceByCitationId.get(citationId);
        return item ? [item] : [];
    });
    if (citedEvidence.length === 0) throw new Error("Generation returned no citations from the supplied evidence");

    return {
        answer: generated.answer,
        citations: citedEvidence.map(({ citationId: _citationId, text: excerpt, ...citation }) => ({ ...citation, excerpt })),
        insufficientEvidence: false,
    };
}

function retrievalQueryFor(question: string, conversation: SynthesisConversationTurn[]): string {
    return [question, ...conversation.map(turn => turn.question)].join("\n");
}

function evidenceFor(recalled: Awaited<ReturnType<typeof recallKnowledgeItems>>): SynthesisEvidence[] {
    const evidence: SynthesisEvidence[] = [];
    let characterCount = 0;
    for (const result of recalled) {
        for (const [excerptIndex, excerpt] of result.excerpts.entries()) {
            if (evidence.length >= maximumEvidenceItems || characterCount >= maximumEvidenceCharacters) return evidence;
            const text = excerpt.text.slice(0, Math.min(maximumExcerptCharacters, maximumEvidenceCharacters - characterCount));
            if (!text) continue;
            characterCount += text.length;
            evidence.push({
                citationId: `knowledge-item-${result.id}-excerpt-${excerptIndex + 1}`,
                knowledgeItemId: result.id,
                sourceSnapshotId: excerpt.sourceSnapshot?.id ?? null,
                title: result.title ?? result.sourcePreview?.title ?? result.source.submittedUrl ?? "Captured Knowledge Item",
                text,
                originalUrl: excerpt.sourceSnapshot?.originalUrl ?? result.source.submittedUrl ?? "",
                evidenceCoverage: excerpt.sourceSnapshot?.evidenceCoverage ?? null,
            });
        }
    }
    return evidence;
}

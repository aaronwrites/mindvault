import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";
import type { EmbeddingProvider, SynthesisConversationTurn, SynthesisEvidence, SynthesisGenerationProvider } from "../ai/providers";
import { boundConversation, boundSynthesisInput } from "./bound-conversation";
import { recallKnowledgeItems } from "../recall/recall-knowledge-items";

type Database = NodePgDatabase<typeof schema>;

const maximumEvidenceItems = 8;
const maximumEvidenceCharacters = 12_000;
const maximumExcerptCharacters = 1_500;

export type SynthesisResult = {
    answer: string;
    citations: Array<Omit<SynthesisEvidence, "citationId" | "text"> & { excerpt: string }>;
    insufficientEvidence: boolean;
};

export async function synthesizeKnowledge(
    database: Database,
    question: string,
    conversation: SynthesisConversationTurn[],
    embeddingProvider: EmbeddingProvider,
    generationProvider: SynthesisGenerationProvider,
): Promise<SynthesisResult> {
    conversation = boundConversation(conversation);
    // Resolve conversational references before retrieving fresh active evidence.
    // The resolved question is a search input, never source evidence.
    const retrievalQuestion = conversation.length > 0
        ? await generationProvider.resolveQuestion({ question, conversation }) : question;
    const recalled = await recallKnowledgeItems(database, retrievalQuestion, embeddingProvider);
    const input = boundSynthesisInput({ question, evidence: evidenceFor(recalled), conversation });
    const evidence = input.evidence;
    if (evidence.length === 0) {
        return {
            answer: "I don't have enough captured evidence to answer that question.",
            citations: [],
            insufficientEvidence: true,
        };
    }

    const generated = await generationProvider.generateSynthesis(input);
    if (generated.insufficientEvidence) {
        return { answer: generated.answer, citations: [], insufficientEvidence: true };
    }
    const evidenceByCitationId = new Map(evidence.map(item => [item.citationId, item]));
    const invalidCitationIds = generated.citationIds.filter(citationId => !evidenceByCitationId.has(citationId));
    if (invalidCitationIds.length > 0) throw new Error("Generation returned citations outside the supplied evidence");
    const citedEvidence = [...new Set(generated.citationIds)].flatMap(citationId => {
        const item = evidenceByCitationId.get(citationId);
        return item ? [item] : [];
    });
    if (citedEvidence.length === 0) {
        return {
            answer: "I couldn't find captured evidence that answers that question.",
            citations: [],
            insufficientEvidence: true,
        };
    }

    return {
        answer: generated.answer,
        citations: citedEvidence.map(({ citationId: _citationId, text: excerpt, ...citation }) => ({ ...citation, excerpt })),
        insufficientEvidence: false,
    };
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
                origin: excerpt.origin,
                knowledgeItemId: result.id,
                sourceSnapshotId: excerpt.sourceSnapshot?.id ?? null,
                title: result.title ?? result.sourcePreview?.title ?? result.source.filename ?? result.source.submittedUrl ?? "Captured Knowledge Item",
                text,
                originalUrl: excerpt.sourceSnapshot?.originalUrl ?? result.source.submittedUrl ?? null,
                pageNumber: excerpt.pageNumber,
                pageLabel: excerpt.pageLabel,
                extractionCoverage: excerpt.sourceSnapshot?.extractionCoverage,
                openOriginalFile: excerpt.openOriginalFile,
                evidenceCoverage: excerpt.sourceSnapshot?.evidenceCoverage ?? null,
            });
        }
    }
    return evidence;
}

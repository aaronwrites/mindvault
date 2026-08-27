import type { CaptureContextKind } from "../../db/schema";

const RECIPROCAL_RANK_FUSION_OFFSET = 60;
const CAPTURE_CONTEXT_BOOST = 1.5;
const ADDITIONAL_PASSAGE_CONTRIBUTION = 0.25;

export type RankedPassageInput = {
    passageId: number;
    knowledgeItemId: number;
    origin: "source-snapshot" | CaptureContextKind;
    text: string;
    rank: number;
};

export type HybridPassageMatch = {
    passageId: number;
    origin: "source-snapshot" | CaptureContextKind;
    text: string;
    score: number;
    semanticRank?: number;
    lexicalRank?: number;
};

export type HybridKnowledgeItemMatch = {
    knowledgeItemId: number;
    score: number;
    passages: HybridPassageMatch[];
};

export function aggregateHybridPassageMatches({
    semantic,
    lexical,
}: {
    semantic: RankedPassageInput[];
    lexical: RankedPassageInput[];
}): HybridKnowledgeItemMatch[] {
    const passages = new Map<number, {
        knowledgeItemId: number;
        origin: RankedPassageInput["origin"];
        text: string;
        semanticRank?: number;
        lexicalRank?: number;
    }>();

    for (const [matches, rankName] of [[semantic, "semanticRank"], [lexical, "lexicalRank"]] as const) {
        for (const match of matches) {
            const passage = passages.get(match.passageId) ?? {
                knowledgeItemId: match.knowledgeItemId,
                origin: match.origin,
                text: match.text,
            };
            passage[rankName] = match.rank;
            passages.set(match.passageId, passage);
        }
    }

    const matchesByKnowledgeItem = new Map<number, HybridPassageMatch[]>();
    for (const [passageId, passage] of passages) {
        const score = reciprocalRankFusionScore(passage.semanticRank, passage.lexicalRank)
            * (passage.origin === "source-snapshot" ? 1 : CAPTURE_CONTEXT_BOOST);
        const matches = matchesByKnowledgeItem.get(passage.knowledgeItemId) ?? [];
        matches.push({ passageId, origin: passage.origin, text: passage.text, score, semanticRank: passage.semanticRank, lexicalRank: passage.lexicalRank });
        matchesByKnowledgeItem.set(passage.knowledgeItemId, matches);
    }

    return [...matchesByKnowledgeItem.entries()]
        .map(([knowledgeItemId, matches]) => {
            const passages = matches.sort((left, right) => right.score - left.score || left.passageId - right.passageId);
            const score = passages.reduce((total, passage, index) => total + passage.score * (index === 0 ? 1 : ADDITIONAL_PASSAGE_CONTRIBUTION), 0);
            return { knowledgeItemId, score, passages };
        })
        .sort((left, right) => right.score - left.score || left.knowledgeItemId - right.knowledgeItemId);
}

function reciprocalRankFusionScore(semanticRank?: number, lexicalRank?: number): number {
    return [semanticRank, lexicalRank]
        .filter((rank): rank is number => rank !== undefined)
        .reduce((score, rank) => score + 1 / (RECIPROCAL_RANK_FUSION_OFFSET + rank), 0);
}

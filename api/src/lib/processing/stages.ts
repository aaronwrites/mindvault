export const processingStageKinds = [
    "extraction",
    "snapshot-persistence",
    "passage-generation",
    "lexical-indexing",
    "semantic-indexing",
    "recognition-summary-generation",
    "topic-tag-generation",
] as const;

export type ProcessingStageKind = typeof processingStageKinds[number];

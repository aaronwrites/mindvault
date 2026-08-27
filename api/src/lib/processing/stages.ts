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

export const requiredRetrievalStageKinds: ReadonlySet<ProcessingStageKind> = new Set([
    "extraction",
    "snapshot-persistence",
    "passage-generation",
    "lexical-indexing",
    "semantic-indexing",
]);

export function isRequiredRetrievalStage(kind: string): boolean {
    return requiredRetrievalStageKinds.has(kind as ProcessingStageKind);
}

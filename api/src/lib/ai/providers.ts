export const MAXIMUM_RECOGNITION_SUMMARY_CHARACTERS = 320;

export interface TextGenerationProvider {
    generate(prompt: string): Promise<string>;
}

export type SynthesisEvidence = {
    citationId: string;
    origin: "source-snapshot" | "selected-source-text" | "personal-note";
    knowledgeItemId: number;
    sourceSnapshotId: number | null;
    title: string;
    text: string;
    originalUrl: string;
    evidenceCoverage: "primary-content" | "metadata-only" | null;
};

export type SynthesisConversationTurn = {
    question: string;
    answer: string;
};

export type SynthesisGenerationInput = {
    question: string;
    evidence: SynthesisEvidence[];
    conversation: SynthesisConversationTurn[];
};

export interface SynthesisGenerationProvider {
    resolveQuestion(input: { question: string; conversation: SynthesisConversationTurn[] }): Promise<string>;
    generateSynthesis(input: SynthesisGenerationInput): Promise<{
        answer: string;
        citationIds: string[];
        insufficientEvidence: boolean;
    }>;
}

export type GeneratedTopicTag = {
    name: string;
    aliases: string[];
};

export interface TopicTagGenerationProvider {
    generateTopicTags(prompt: string): Promise<GeneratedTopicTag[]>;
}

export interface EmbeddingProvider {
    representation: EmbeddingRepresentation;
    embed(text: string): Promise<number[]>;
    embedQuery(text: string): Promise<number[]>;
}

export type EmbeddingRepresentation = {
    provider: string;
    model: string;
    dimensions: number;
    metadata: Record<string, unknown>;
};

export function validateEmbedding(embedding: number[], representation: EmbeddingRepresentation): void {
    const magnitude = Math.sqrt(embedding.reduce((sum, value) => sum + value * value, 0));
    if (
        embedding.length !== representation.dimensions
        || embedding.some(value => !Number.isFinite(value))
        || !Number.isFinite(magnitude)
        || magnitude === 0
    ) {
        throw new Error(`Embedding provider returned an invalid ${representation.dimensions}-dimension embedding`);
    }
}

export interface Clock {
    now(): Date;
}

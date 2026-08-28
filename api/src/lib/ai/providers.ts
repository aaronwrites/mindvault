export interface TextGenerationProvider {
    generate(prompt: string): Promise<string>;
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
    if (embedding.length !== representation.dimensions || embedding.some(value => !Number.isFinite(value))) {
        throw new Error(`Embedding provider returned an invalid ${representation.dimensions}-dimension embedding`);
    }
}

export interface Clock {
    now(): Date;
}

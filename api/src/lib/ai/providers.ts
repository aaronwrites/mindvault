export interface TextGenerationProvider {
    generate(prompt: string): Promise<string>;
}

export interface EmbeddingProvider {
    embed(text: string): Promise<number[]>;
}

export interface Clock {
    now(): Date;
}

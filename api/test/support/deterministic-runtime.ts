import { EMBEDDING_DIMENSIONS } from "../../src/db/schema";
import type { Clock, EmbeddingProvider, TextGenerationProvider } from "../../src/lib/ai/providers";

export class DeterministicGenerationProvider implements TextGenerationProvider {
    constructor(private readonly response = "deterministic generated text") {}

    async generate(_prompt: string): Promise<string> {
        return this.response;
    }
}

export class DeterministicEmbeddingProvider implements EmbeddingProvider {
    async embed(text: string): Promise<number[]> {
        let hash = 0;
        for (const character of text) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
        const vector = Array<number>(EMBEDDING_DIMENSIONS).fill(0);
        vector[hash % EMBEDDING_DIMENSIONS] = 1;
        return vector;
    }
}

export class ManualClock implements Clock {
    constructor(private currentTime: Date) {}

    now(): Date {
        return new Date(this.currentTime);
    }

    advance(milliseconds: number): void {
        this.currentTime = new Date(this.currentTime.getTime() + milliseconds);
    }
}

export type EligibleWorker = {
    runEligibleWork(): Promise<number>;
};

export async function drainEligibleWork(worker: EligibleWorker, maximumRuns = 100): Promise<void> {
    for (let run = 0; run < maximumRuns; run += 1) {
        if (await worker.runEligibleWork() === 0) return;
    }
    throw new Error(`Worker still had eligible work after ${maximumRuns} runs`);
}

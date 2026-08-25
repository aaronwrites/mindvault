import { GoogleGenAI } from "@google/genai";
import { EMBEDDING_DIMENSIONS } from "../../db/schema";
import type { EmbeddingProvider } from "./providers";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-001";

type ResourceEmbeddingInput = {
    title: string;
    url: string | null;
    sourceType: string;
    summary: string | null;
};

function normalize(values: number[]): number[] {
    const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
    if (!Number.isFinite(magnitude) || magnitude === 0) {
        throw new Error("Gemini returned an invalid embedding");
    }

    return values.map(value => value / magnitude);
}

async function generateEmbedding(
    text: string,
    taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
    title?: string,
): Promise<number[]> {
    let response;
    try {
        response = await ai.models.embedContent({
            model: EMBEDDING_MODEL,
            contents: text,
            config: {
                taskType,
                outputDimensionality: EMBEDDING_DIMENSIONS,
                ...(title ? { title } : {}),
            },
        });
    } catch (error) {
        throw new Error(`Gemini embedding call failed: ${(error as Error).message}`);
    }

    const values = response.embeddings?.[0]?.values;
    if (!values || values.length !== EMBEDDING_DIMENSIONS || values.some(value => !Number.isFinite(value))) {
        throw new Error(`Gemini returned an invalid ${EMBEDDING_DIMENSIONS}-dimension embedding`);
    }

    return normalize(values);
}

export function generateResourceEmbedding(resource: ResourceEmbeddingInput): Promise<number[]> {
    const text = [
        `Title: ${resource.title}`,
        `Type: ${resource.sourceType}`,
        resource.summary ? `Summary: ${resource.summary}` : null,
        resource.url ? `URL: ${resource.url}` : null,
    ].filter(Boolean).join("\n");

    return generateEmbedding(text, "RETRIEVAL_DOCUMENT", resource.title);
}

export function generateQueryEmbedding(query: string): Promise<number[]> {
    return generateEmbedding(query, "RETRIEVAL_QUERY");
}

export function createGeminiPassageEmbeddingProvider(): EmbeddingProvider {
    return {
        representation: {
            provider: "google",
            model: EMBEDDING_MODEL,
            dimensions: EMBEDDING_DIMENSIONS,
            metadata: { taskType: "RETRIEVAL_DOCUMENT", normalized: true },
        },
        embed: text => generateEmbedding(text, "RETRIEVAL_DOCUMENT"),
        embedQuery: text => generateEmbedding(text, "RETRIEVAL_QUERY"),
    };
}

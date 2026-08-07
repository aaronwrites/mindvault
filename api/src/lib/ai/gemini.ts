import { GoogleGenAI, Type, type Schema } from "@google/genai";
import { aiResponseSchema, type AIResponse } from "../../schemas/aiResponseSchema";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });



const responseSchema: Schema = {
    type: Type.OBJECT,
    properties: {
        summary: {
            type: Type.STRING,
            description: "A concise summary of the resource content",
        },
        tags: {
            type: Type.ARRAY,
            items: {
                type: Type.STRING,
            },
            description: "A list of relevant tags or keywords (lowercase)",
        },
        technologies: {
            type: Type.ARRAY,
            items: {
                type: Type.STRING,
            },
            description: "Technologies, languages, or frameworks mentioned",
        },
        content_type: {
            type: Type.STRING,
            description: "The type of content, e.g., 'article', 'video', 'documentation', 'repository'",
        },
        difficulty: {
            type: Type.STRING,
            description: "Estimated difficulty or target audience level, e.g., 'beginner', 'intermediate', 'advanced'",
        },
    },
    required: ["summary", "tags", "technologies", "content_type", "difficulty"],
};

export async function extractResourceMetadata(title: string, url: string | null): Promise<AIResponse> {
    const prompt = `Analyze the following resource and provide structured metadata.
Title: ${title}
${url ? `URL: ${url}` : ''}

Since content extraction is not yet implemented, base your analysis on the title and URL provided.`;

    const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: responseSchema,
        }
    });

    if (!response.text) {
        throw new Error("No text returned from Gemini API");
    }

    const json = JSON.parse(response.text);
    return aiResponseSchema.parse(json);
}

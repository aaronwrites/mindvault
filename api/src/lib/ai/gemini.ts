import { GoogleGenAI, Type, type Schema } from "@google/genai";
import { aiResponseSchema, type AIResponse } from "../../schemas/aiResponseSchema";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";


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
            enum: ["article", "video", "documentation", "repository", "note"],
            description: "The type of content, e.g., 'article', 'video', 'documentation', 'repository'",
        },
        difficulty: {
            type: Type.STRING,
            enum: ["beginner", "intermediate", "advanced"],
            description: "Estimated difficulty or target audience level, e.g., 'beginner', 'intermediate', 'advanced'",
        },
    },
    required: ["summary", "tags", "technologies", "content_type", "difficulty"],
};


function buildPrompt(title: string, url: string | null): string {
    return `Analyze the following resource and produce structured metadata for a developer's personal knowledge base.
    Title: ${title}
    ${url ? `URL: ${url}` : "URL: not provided"}

    Note: full content extraction is not yet implemented — base your analysis on the title and URL only. If the title/URL don't give enough signal for a confident summary, keep the summary short and general rather than inventing specifics you can't know.
    Guidelines:
    - tags: 3-6 specific, lowercase, single-or-hyphenated words (e.g. "react-hooks", not "React Hooks Tutorial")
    - technologies: only include ones clearly implied by the title/URL/domain (e.g. a github.com/vercel/next.js URL implies "Next.js"), leave empty if genuinely unclear
    - summary: 1-2 sentences, don't pad with generic filler if you don't have enough signal`;
}


export async function extractResourceMetadata(title: string, url: string | null): Promise<AIResponse> {
    const prompt = buildPrompt(title, url);

    let response;
    try {
        response = await ai.models.generateContent({
            model: MODEL,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema,
                temperature: 0.3,
            },
        });
    } catch (err) {
        throw new Error(`Gemini API call failed: ${(err as Error).message}`);
    }

    if (!response.text) {
        throw new Error("No text returned from Gemini API");
    }

    let json: unknown;
    try {
        json = JSON.parse(response.text);
    } catch {
        throw new Error("Gemini returned invalid JSON");
    }

    const parsed = aiResponseSchema.safeParse(json);
    if (!parsed.success) {
        throw new Error(`Gemini response failed validation: ${parsed.error.message}`);
    }

    return parsed.data;
}

import { GoogleGenAI } from "@google/genai";
import type { TextGenerationProvider, TopicTagGenerationProvider } from "./providers";
import { z } from "zod";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";


export function createGeminiTextGenerationProvider(): TextGenerationProvider {
    return {
        async generate(prompt: string): Promise<string> {
            let response;
            try {
                response = await ai.models.generateContent({
                    model: MODEL,
                    contents: prompt,
                    config: { temperature: 0.2 },
                });
            } catch (error) {
                throw new Error(`Gemini text generation call failed: ${(error as Error).message}`);
            }
            const text = response.text?.trim();
            if (!text) throw new Error("Gemini returned no generated text");
            return text;
        },
    };
}

const generatedTopicTagsSchema = z.array(z.object({
    name: z.string().min(1),
    aliases: z.array(z.string()),
})).min(1);

export function createGeminiTopicTagGenerationProvider(): TopicTagGenerationProvider {
    return {
        async generateTopicTags(prompt: string) {
            let response;
            try {
                response = await ai.models.generateContent({
                    model: MODEL,
                    contents: prompt,
                    config: { responseMimeType: "application/json", temperature: 0.2 },
                });
            } catch (error) {
                throw new Error(`Gemini Topic Tag generation failed: ${(error as Error).message}`);
            }
            if (!response.text) throw new Error("Gemini returned no Topic Tags");
            const parsed = generatedTopicTagsSchema.safeParse(JSON.parse(response.text));
            if (!parsed.success) throw new Error(`Gemini Topic Tags failed validation: ${parsed.error.message}`);
            return parsed.data;
        },
    };
}

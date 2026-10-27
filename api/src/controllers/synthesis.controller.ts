import { GenerationInputLimitError } from "../lib/ai/providers";
import type { Request, Response } from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import type { EmbeddingProvider, SynthesisGenerationProvider } from "../lib/ai/providers";
import { synthesizeKnowledge } from "../lib/synthesis/synthesize-knowledge";
import { synthesisQuestionSchema } from "../schemas/synthesis";

export function synthesizeKnowledgeController(
    database: NodePgDatabase<typeof schema>,
    embeddingProvider: EmbeddingProvider,
    generationProvider: SynthesisGenerationProvider,
) {
    return async (req: Request, res: Response) => {
        const parsed = synthesisQuestionSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

        try {
            return res.json(await synthesizeKnowledge(database, parsed.data.question, parsed.data.conversation, embeddingProvider, generationProvider));
        } catch (error) {
            if (error instanceof GenerationInputLimitError) {
                return res.status(422).json({ error: "Synthesis exceeds the model input limit. Ask a narrower question or start a new conversation." });
            }
            console.error("Knowledge Synthesis failed:", error);
            return res.status(502).json({ error: "Answer generation is temporarily unavailable. Please try again." });
        }
    };
}

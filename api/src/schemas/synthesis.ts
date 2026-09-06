import { z } from "zod";

const synthesisConversationTurnSchema = z.object({
    question: z.string().trim().min(1).max(2_000),
    answer: z.string().trim().min(1).max(4_000),
});

export const synthesisQuestionSchema = z.object({
    question: z.string().trim().min(1, "Question is required").max(2_000, "Question is too long"),
    conversation: z.array(synthesisConversationTurnSchema).max(6, "Conversation is too long").default([]),
});

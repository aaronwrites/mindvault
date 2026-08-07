import z from "zod";

export const aiResponseSchema = z.object({
    summary: z.string().describe("A concise summary of the resource content"),
    tags: z.array(z.string()).describe("A list of relevant tags or keywords (lowercase)"),
    technologies: z.array(z.string()).describe("Technologies, languages, or frameworks mentioned"),
    content_type: z.string().describe("The type of content, e.g., 'article', 'video', 'documentation', 'repository'"),
    difficulty: z.string().describe("Estimated difficulty or target audience level, e.g., 'beginner', 'intermediate', 'advanced'")
});

export type AIResponse = z.infer<typeof aiResponseSchema>;
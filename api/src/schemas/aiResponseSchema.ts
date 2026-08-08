import z from "zod";

export const aiResponseSchema = z.object({
    summary: z.string().describe("A concise summary of the resource content"),
    tags: z.array(z.string()).describe("A list of relevant tags or keywords (lowercase)"),
    content_type: z.enum(["article", "video", "documentation", "repository", "note", "url"]).describe("The type of content, e.g., 'article', 'video', 'documentation', 'repository'")
});

export type AIResponse = z.infer<typeof aiResponseSchema>;
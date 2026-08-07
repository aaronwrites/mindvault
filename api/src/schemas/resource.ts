import { z } from "zod";

export const createResourceSchema = z.object({
    title: z.string().min(1),
    url: z.url().optional(),
    sourceType: z.enum(["article", "repo", "video", "pdf", "note"]),
});

export type CreateResourceInput = z.infer<typeof createResourceSchema>;
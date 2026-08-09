import { z } from "zod";

export const searchQuerySchema = z.object({
    q: z.string().trim().min(1, "Search query is required").max(500, "Search query is too long"),
});

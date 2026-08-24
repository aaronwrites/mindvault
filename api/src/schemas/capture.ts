import { z } from "zod";

const publicHttpUrl = z.url().refine(value => {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
}, "URL must use HTTP or HTTPS");

export const createCaptureSchema = z.object({
    url: publicHttpUrl,
    selectedText: z.string().trim().min(1).optional(),
    personalNote: z.string().trim().min(1).optional(),
});

export type CreateCaptureInput = z.infer<typeof createCaptureSchema>;

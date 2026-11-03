import { z } from "zod";

export const updateTitleSchema = z.object({
    customTitle: z.string().refine(title => !/[\u0000-\u001F\u007F]/.test(title)).trim().min(1).max(500).nullable(),
}).strict();

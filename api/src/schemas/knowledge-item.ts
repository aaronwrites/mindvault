import { z } from "zod";

export const updateTitleSchema = z.object({
    customTitle: z.string().refine(title => !/[\u0000-\u001F\u007F]/.test(title)).trim().min(1).max(500).nullable(),
}).strict();

const tagName = z.string().refine(value => !/[\u0000-\u001F\u007F]/.test(value)).normalize("NFKC").trim().min(1).max(100);
export const updateTagsSchema = z.object({
    add: z.array(tagName).max(50),
    // Generated and pre-existing names may exceed the new-name limit.
    remove: z.array(z.string().normalize("NFKC").trim().min(1)).max(50),
}).strict().refine(value => value.add.length + value.remove.length > 0);

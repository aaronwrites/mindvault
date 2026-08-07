import type { Request, Response } from "express";
import { db } from "../db";
import { resources } from "../db/schema";
import { createResourceSchema } from "../schemas/resource";
import { desc, eq } from "drizzle-orm";

export const createResource = async (req: Request, res: Response) => {
    const parsed = createResourceSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
    }

    const [resource] = await db
        .insert(resources)
        .values(parsed.data)
        .returning();

    res.status(201).json(resource);
};

export const listResources = async (_req: Request, res: Response) => {
    const all = await db
        .select()
        .from(resources)
        .orderBy(desc(resources.createdAt));

    res.json(all);
};

export const getResource = async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const [resource] = await db
        .select()
        .from(resources)
        .where(eq(resources.id, id));

    if (!resource) return res.status(404).json({ error: "Not found" });
    res.json(resource);
};
import type { Request, Response } from "express";
import { db } from "../db";
import { resources, tags, resourceTags } from "../db/schema";
import { createResourceSchema } from "../schemas/resource";
import { desc, eq, inArray } from "drizzle-orm";
import { extractResourceMetadata } from "../lib/ai/gemini";

const attachTags = async <T extends { id: number }>(resourceRows: T[]) => {
    if (resourceRows.length === 0) return [];

    const tagRows = await db
        .select({
            resourceId: resourceTags.resourceId,
            name: tags.name,
        })
        .from(resourceTags)
        .innerJoin(tags, eq(resourceTags.tagId, tags.id))
        .where(inArray(resourceTags.resourceId, resourceRows.map(resource => resource.id)));

    const tagsByResource = new Map<number, string[]>();
    for (const tag of tagRows) {
        if (tag.resourceId === null) continue;
        const resourceTagNames = tagsByResource.get(tag.resourceId) ?? [];
        resourceTagNames.push(tag.name);
        tagsByResource.set(tag.resourceId, resourceTagNames);
    }

    return resourceRows.map(resource => ({
        ...resource,
        tags: tagsByResource.get(resource.id) ?? [],
    }));
};

export const createResource = async (req: Request, res: Response) => {
    const parsed = createResourceSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
    }

    let [resource] = await db
        .insert(resources)
        .values(parsed.data)
        .returning();

    if (!resource) return res.status(500).json({
        error: "Error while creating resource"
    })
    const resourceId = resource.id;

    try {
        const metadata = await extractResourceMetadata(resource.title, resource.url);
        console.log(metadata);
        const updated = await db
            .update(resources)
            .set({
                summary: metadata.summary,
                metadata: {
                    content_type: metadata.content_type,
                }
            })
            .where(eq(resources.id, resourceId))
            .returning();
        if (updated[0]) resource = updated[0];

        if (metadata.tags && metadata.tags.length > 0) {
            await db.insert(tags)
                .values(metadata.tags.map(t => ({ name: t })))
                .onConflictDoNothing();

            const insertedTags = await db.select()
                .from(tags)
                .where(inArray(tags.name, metadata.tags));

            if (insertedTags.length > 0) {
                await db.insert(resourceTags)
                    .values(insertedTags.map(t => ({
                        resourceId,
                        tagId: t.id
                    })));
            }
        }
    } catch (error) {
        console.error("Failed to extract metadata from AI:", error);
    }

    const [resourceWithTags] = await attachTags([resource]);
    res.status(201).json(resourceWithTags);
};

export const listResources = async (_req: Request, res: Response) => {
    const all = await db
        .select()
        .from(resources)
        .orderBy(desc(resources.createdAt));

    res.json(await attachTags(all));
};

export const getResource = async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const [resource] = await db
        .select()
        .from(resources)
        .where(eq(resources.id, id));

    if (!resource) return res.status(404).json({ error: "Not found" });
    const [resourceWithTags] = await attachTags([resource]);
    res.json(resourceWithTags);
};

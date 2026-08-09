import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { resourceTags, tags } from "../db/schema";

export async function attachTags<T extends { id: number }>(resourceRows: T[]) {
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
}

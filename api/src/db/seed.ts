import { db } from "./index";
import { embeddings, resources, tags, resourceTags } from "./schema";
import { generateResourceEmbedding } from "../lib/ai/embeddings";

async function seed() {
    console.log("Seeding database...");

    const [closures, dockerGuide, reactRepo] = await db
        .insert(resources)
        .values([
            {
                title: "Understanding Closures in JavaScript",
                url: "https://example.com/closures-guide",
                sourceType: "article",
                summary: "A guide to closures in JavaScript, covering lexical scoping and common pitfalls.",
            },
            {
                title: "Docker Compose Best Practices",
                url: "https://example.com/docker-compose-guide",
                sourceType: "article",
                summary: "Practical patterns for structuring multi-service Docker Compose files.",
            },
            {
                title: "facebook/react",
                url: "https://github.com/facebook/react",
                sourceType: "repo",
                summary: "The official React repository — a JavaScript library for building user interfaces.",
            },
        ])
        .returning();

    const [jsTag, dockerTag, reactTag] = await db
        .insert(tags)
        .values([{ name: "javascript" }, { name: "docker" }, { name: "react" }])
        .returning();

    await db.insert(resourceTags).values([
        { resourceId: closures?.id, tagId: jsTag?.id },
        { resourceId: dockerGuide?.id, tagId: dockerTag?.id },
        { resourceId: reactRepo?.id, tagId: reactTag?.id },
        { resourceId: reactRepo?.id, tagId: jsTag?.id },
    ]);

    for (const resource of [closures, dockerGuide, reactRepo]) {
        if (!resource) continue;
        const embedding = await generateResourceEmbedding(resource);
        await db.insert(embeddings).values({ resourceId: resource.id, embedding });
    }

    console.log("Seed complete.");
    process.exit(0);
}

seed().catch((err) => {
    console.error(err);
    process.exit(1);
});

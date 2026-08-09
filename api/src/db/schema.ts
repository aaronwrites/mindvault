import { pgTable, serial, text, timestamp, jsonb, integer, vector } from "drizzle-orm/pg-core";

export const EMBEDDING_DIMENSIONS = 768;

export const resources = pgTable("resources", {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    url: text("url"),
    sourceType: text("source_type").notNull(),
    summary: text("summary"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow(),
});

export const tags = pgTable("tags", {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
});

export const resourceTags = pgTable("resource_tags", {
    resourceId: integer("resource_id").references(() => resources.id),
    tagId: integer("tag_id").references(() => tags.id),
});

export const embeddings = pgTable("embeddings", {
    resourceId: integer("resource_id")
        .primaryKey()
        .references(() => resources.id, { onDelete: "cascade" }),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
});

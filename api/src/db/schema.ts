import { check, customType, index, pgTable, serial, text, timestamp, jsonb, integer, vector, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const EMBEDDING_DIMENSIONS = 768;
const tsvector = customType<{ data: string }>({
    dataType() {
        return "tsvector";
    },
});
export const captureContextKinds = ["selected-source-text", "personal-note"] as const;
export type CaptureContextKind = typeof captureContextKinds[number];

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

export const sources = pgTable("sources", {
    id: serial("id").primaryKey(),
    submittedUrl: text("submitted_url").notNull(),
    normalizedUrl: text("normalized_url").notNull(),
    sourceKind: text("source_kind").notNull().default("web"),
    currentSnapshotId: integer("current_snapshot_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
}, table => [uniqueIndex("sources_normalized_url_unique").on(table.normalizedUrl)]);

export const knowledgeItems = pgTable("knowledge_items", {
    id: serial("id").primaryKey(),
    sourceId: integer("source_id").notNull().references(() => sources.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
}, table => [uniqueIndex("knowledge_items_source_id_unique").on(table.sourceId)]);

export const captures = pgTable("captures", {
    id: serial("id").primaryKey(),
    sourceId: integer("source_id").notNull().references(() => sources.id),
    knowledgeItemId: integer("knowledge_item_id").notNull().references(() => knowledgeItems.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const captureContexts = pgTable("capture_contexts", {
    id: serial("id").primaryKey(),
    captureId: integer("capture_id").notNull().references(() => captures.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    text: text("text").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const processingAttempts = pgTable("processing_attempts", {
    id: serial("id").primaryKey(),
    knowledgeItemId: integer("knowledge_item_id").notNull().references(() => knowledgeItems.id),
    sourceSnapshotId: integer("source_snapshot_id").references(() => sourceSnapshots.id),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("pending"),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const extractedSources = pgTable("extracted_sources", {
    id: serial("id").primaryKey(),
    processingAttemptId: integer("processing_attempt_id").notNull().references(() => processingAttempts.id, { onDelete: "cascade" }).unique(),
    sourceId: integer("source_id").notNull().references(() => sources.id),
    title: text("title").notNull(),
    primaryText: text("primary_text").notNull(),
    originalUrl: text("original_url").notNull(),
    finalUrl: text("final_url").notNull(),
    canonicalUrl: text("canonical_url"),
    permanentRedirects: jsonb("permanent_redirects").notNull(),
    extractedAt: timestamp("extracted_at").notNull().defaultNow(),
});

export const sourceSnapshots = pgTable("source_snapshots", {
    id: serial("id").primaryKey(),
    sourceId: integer("source_id").notNull().references(() => sources.id),
    title: text("title").notNull(),
    primaryText: text("primary_text").notNull(),
    originalUrl: text("original_url").notNull(),
    finalUrl: text("final_url").notNull(),
    canonicalUrl: text("canonical_url"),
    permanentRedirects: jsonb("permanent_redirects").notNull(),
    extractedAt: timestamp("extracted_at").notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
}, table => [uniqueIndex("source_snapshots_source_content_hash_unique").on(table.sourceId, table.contentHash)]);

export const recognitionSummaries = pgTable("recognition_summaries", {
    knowledgeItemId: integer("knowledge_item_id").primaryKey().references(() => knowledgeItems.id, { onDelete: "cascade" }),
    sourceSnapshotId: integer("source_snapshot_id").notNull().references(() => sourceSnapshots.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    generatedAt: timestamp("generated_at").notNull().defaultNow(),
});

export const passages = pgTable("passages", {
    id: serial("id").primaryKey(),
    sourceSnapshotId: integer("source_snapshot_id").references(() => sourceSnapshots.id, { onDelete: "cascade" }),
    captureContextId: integer("capture_context_id").references(() => captureContexts.id, { onDelete: "cascade" }),
    origin: text("origin").notNull(),
    text: text("text").notNull(),
    lexicalSearch: tsvector("lexical_search"),
    ordinal: integer("ordinal").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
}, table => [
    uniqueIndex("passages_source_snapshot_ordinal_unique").on(table.sourceSnapshotId, table.ordinal),
    uniqueIndex("passages_capture_context_ordinal_unique").on(table.captureContextId, table.ordinal),
    index("passages_lexical_search_index").using("gin", table.lexicalSearch),
    check("passages_one_content_origin", sql`(
        (source_snapshot_id IS NOT NULL AND capture_context_id IS NULL AND origin = 'source-snapshot')
        OR (source_snapshot_id IS NULL AND capture_context_id IS NOT NULL AND origin IN ('selected-source-text', 'personal-note'))
    )`),
]);

export const processingStages = pgTable("processing_stages", {
    id: serial("id").primaryKey(),
    processingAttemptId: integer("processing_attempt_id").notNull().references(() => processingAttempts.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("pending"),
    prerequisiteStageId: integer("prerequisite_stage_id"),
    availableAt: timestamp("available_at").notNull().defaultNow(),
    leaseToken: text("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at"),
    attemptCount: integer("attempt_count").notNull().default(0),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const passageEmbeddings = pgTable("passage_embeddings", {
    passageId: integer("passage_id").primaryKey().references(() => passages.id, { onDelete: "cascade" }),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    dimensions: integer("dimensions").notNull(),
    metadata: jsonb("metadata").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

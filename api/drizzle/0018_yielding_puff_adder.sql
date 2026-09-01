CREATE TABLE "original_file_operations" (
	"id" serial PRIMARY KEY NOT NULL,
	"original_file_source_id" integer NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"available_at" timestamp DEFAULT now() NOT NULL,
	"lease_token" text,
	"lease_expires_at" timestamp,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"failure_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "original_file_operations_kind" CHECK ("original_file_operations"."kind" IN ('upload', 'delete')),
	CONSTRAINT "original_file_operations_status" CHECK ("original_file_operations"."status" IN ('pending', 'running', 'completed', 'failed')),
	CONSTRAINT "original_file_operations_lease" CHECK ((
        ("original_file_operations"."status" = 'running' AND "original_file_operations"."lease_token" IS NOT NULL AND "original_file_operations"."lease_expires_at" IS NOT NULL)
        OR ("original_file_operations"."status" <> 'running' AND "original_file_operations"."lease_token" IS NULL AND "original_file_operations"."lease_expires_at" IS NULL)
    ))
);
--> statement-breakpoint
CREATE TABLE "original_files" (
	"source_id" integer PRIMARY KEY NOT NULL,
	"content_hash" text NOT NULL,
	"byte_size" integer NOT NULL,
	"detected_media_type" text NOT NULL,
	"storage_provider" text NOT NULL,
	"provider_identity" text NOT NULL,
	"storage_locator" text,
	"storage_state" text DEFAULT 'pending-upload' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "original_files_positive_byte_size" CHECK ("original_files"."byte_size" > 0),
	CONSTRAINT "original_files_storage_state" CHECK ("original_files"."storage_state" IN ('pending-upload', 'stored', 'pending-deletion')),
	CONSTRAINT "original_files_complete_provider_state" CHECK ((
        ("original_files"."storage_state" = 'pending-upload' AND "original_files"."storage_locator" IS NULL)
        OR ("original_files"."storage_state" IN ('stored', 'pending-deletion') AND "original_files"."storage_locator" IS NOT NULL)
    ))
);
--> statement-breakpoint
CREATE TABLE "webpage_sources" (
	"source_id" integer PRIMARY KEY NOT NULL,
	"submitted_url" text NOT NULL,
	"normalized_url" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "captures" ADD COLUMN "submitted_filename" text;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD COLUMN "lifecycle_state" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD COLUMN "trashed_at" timestamp;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD COLUMN "deletion_requested_at" timestamp;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "provenance_kind" text;--> statement-breakpoint
ALTER TABLE "original_file_operations" ADD CONSTRAINT "original_file_operations_original_file_source_id_original_files_source_id_fk" FOREIGN KEY ("original_file_source_id") REFERENCES "public"."original_files"("source_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "original_files" ADD CONSTRAINT "original_files_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webpage_sources" ADD CONSTRAINT "webpage_sources_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "original_files_content_hash_unique" ON "original_files" USING btree ("content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "webpage_sources_normalized_url_unique" ON "webpage_sources" USING btree ("normalized_url");--> statement-breakpoint
INSERT INTO "webpage_sources" ("source_id", "submitted_url", "normalized_url", "created_at")
SELECT "id", "submitted_url", "normalized_url", "created_at" FROM "sources";--> statement-breakpoint
UPDATE "sources"
SET "provenance_kind" = 'webpage';--> statement-breakpoint
ALTER TABLE "sources" ALTER COLUMN "provenance_kind" SET NOT NULL;--> statement-breakpoint
DROP INDEX "sources_normalized_url_unique";--> statement-breakpoint
ALTER TABLE "sources" ALTER COLUMN "source_kind" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "sources" DROP COLUMN "submitted_url";--> statement-breakpoint
ALTER TABLE "sources" DROP COLUMN "normalized_url";--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_lifecycle_state" CHECK ("knowledge_items"."lifecycle_state" IN ('active', 'trashed', 'pending-permanent-deletion'));--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_lifecycle_timestamps" CHECK ((
        ("knowledge_items"."lifecycle_state" = 'active' AND "knowledge_items"."trashed_at" IS NULL AND "knowledge_items"."deletion_requested_at" IS NULL)
        OR ("knowledge_items"."lifecycle_state" = 'trashed' AND "knowledge_items"."trashed_at" IS NOT NULL AND "knowledge_items"."deletion_requested_at" IS NULL)
        OR ("knowledge_items"."lifecycle_state" = 'pending-permanent-deletion' AND "knowledge_items"."trashed_at" IS NOT NULL AND "knowledge_items"."deletion_requested_at" IS NOT NULL)
    ));--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_provenance_kind" CHECK ("sources"."provenance_kind" IN ('webpage', 'original-file'));
--> statement-breakpoint
CREATE FUNCTION "assert_source_provenance"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    checked_source_id integer;
    source_provenance text;
BEGIN
    IF TG_TABLE_NAME = 'sources' THEN
        checked_source_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
    ELSE
        checked_source_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.source_id ELSE NEW.source_id END;
    END IF;
    SELECT provenance_kind INTO source_provenance FROM sources WHERE id = checked_source_id;
    IF NOT FOUND THEN RETURN NULL; END IF;

    IF source_provenance = 'webpage' AND (
        NOT EXISTS (SELECT 1 FROM webpage_sources WHERE source_id = checked_source_id)
        OR EXISTS (SELECT 1 FROM original_files WHERE source_id = checked_source_id)
    ) THEN
        RAISE EXCEPTION 'A webpage Source must have exactly webpage provenance';
    END IF;
    IF source_provenance = 'original-file' AND (
        NOT EXISTS (SELECT 1 FROM original_files WHERE source_id = checked_source_id)
        OR EXISTS (SELECT 1 FROM webpage_sources WHERE source_id = checked_source_id)
    ) THEN
        RAISE EXCEPTION 'An Original File Source must have exactly Original File provenance';
    END IF;
    RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "sources_provenance_matches_child"
AFTER INSERT OR UPDATE OF "provenance_kind" ON "sources"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "assert_source_provenance"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "webpage_sources_provenance_matches_source"
AFTER INSERT OR UPDATE OR DELETE ON "webpage_sources"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "assert_source_provenance"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "original_files_provenance_matches_source"
AFTER INSERT OR UPDATE OR DELETE ON "original_files"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "assert_source_provenance"();

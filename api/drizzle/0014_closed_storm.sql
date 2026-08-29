CREATE TABLE "source_previews" (
	"source_snapshot_id" integer PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"website_name" text,
	"author" text,
	"published_at" timestamp,
	"content_type" text NOT NULL,
	"preview_image_url" text,
	"preview_image_alt" text,
	"favicon_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "extracted_sources" ADD COLUMN "source_preview" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "source_previews" ADD CONSTRAINT "source_previews_source_snapshot_id_source_snapshots_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshots"("id") ON DELETE cascade ON UPDATE no action;
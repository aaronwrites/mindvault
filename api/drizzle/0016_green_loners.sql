CREATE TABLE "source_preview_media" (
	"source_snapshot_id" integer PRIMARY KEY NOT NULL,
	"source_url" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_preview_media" ADD CONSTRAINT "source_preview_media_source_snapshot_id_source_snapshots_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshots"("id") ON DELETE cascade ON UPDATE no action;
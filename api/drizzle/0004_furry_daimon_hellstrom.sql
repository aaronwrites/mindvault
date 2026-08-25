CREATE TABLE "source_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"title" text NOT NULL,
	"primary_text" text NOT NULL,
	"original_url" text NOT NULL,
	"final_url" text NOT NULL,
	"canonical_url" text,
	"permanent_redirects" jsonb NOT NULL,
	"extracted_at" timestamp NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_snapshots" ADD CONSTRAINT "source_snapshots_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_snapshots_source_content_hash_unique" ON "source_snapshots" USING btree ("source_id","content_hash");
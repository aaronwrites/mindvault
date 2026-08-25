CREATE TABLE "extracted_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"processing_attempt_id" integer NOT NULL,
	"source_id" integer NOT NULL,
	"title" text NOT NULL,
	"primary_text" text NOT NULL,
	"original_url" text NOT NULL,
	"final_url" text NOT NULL,
	"canonical_url" text,
	"permanent_redirects" jsonb NOT NULL,
	"extracted_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "extracted_sources_processing_attempt_id_unique" UNIQUE("processing_attempt_id")
);
--> statement-breakpoint
ALTER TABLE "processing_attempts" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "processing_stages" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "extracted_sources" ADD CONSTRAINT "extracted_sources_processing_attempt_id_processing_attempts_id_fk" FOREIGN KEY ("processing_attempt_id") REFERENCES "public"."processing_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracted_sources" ADD CONSTRAINT "extracted_sources_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;
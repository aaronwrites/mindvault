CREATE TABLE "capture_contexts" (
	"id" serial PRIMARY KEY NOT NULL,
	"capture_id" integer NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "captures" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"knowledge_item_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processing_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"knowledge_item_id" integer NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processing_stages" (
	"id" serial PRIMARY KEY NOT NULL,
	"processing_attempt_id" integer NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"prerequisite_stage_id" integer,
	"available_at" timestamp DEFAULT now() NOT NULL,
	"lease_token" text,
	"lease_expires_at" timestamp,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"submitted_url" text NOT NULL,
	"normalized_url" text NOT NULL,
	"source_kind" text DEFAULT 'web' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "capture_contexts" ADD CONSTRAINT "capture_contexts_capture_id_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."captures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_knowledge_item_id_knowledge_items_id_fk" FOREIGN KEY ("knowledge_item_id") REFERENCES "public"."knowledge_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_attempts" ADD CONSTRAINT "processing_attempts_knowledge_item_id_knowledge_items_id_fk" FOREIGN KEY ("knowledge_item_id") REFERENCES "public"."knowledge_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_stages" ADD CONSTRAINT "processing_stages_processing_attempt_id_processing_attempts_id_fk" FOREIGN KEY ("processing_attempt_id") REFERENCES "public"."processing_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_items_source_id_unique" ON "knowledge_items" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_normalized_url_unique" ON "sources" USING btree ("normalized_url");
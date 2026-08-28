CREATE TABLE "recognition_summaries" (
	"knowledge_item_id" integer PRIMARY KEY NOT NULL,
	"source_snapshot_id" integer NOT NULL,
	"text" text NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recognition_summaries" ADD CONSTRAINT "recognition_summaries_knowledge_item_id_knowledge_items_id_fk" FOREIGN KEY ("knowledge_item_id") REFERENCES "public"."knowledge_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_summaries" ADD CONSTRAINT "recognition_summaries_source_snapshot_id_source_snapshots_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshots"("id") ON DELETE cascade ON UPDATE no action;
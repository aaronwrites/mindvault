CREATE TABLE "knowledge_item_topic_tags" (
	"knowledge_item_id" integer NOT NULL,
	"topic_tag_id" integer NOT NULL,
	"source_snapshot_id" integer NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_item_topic_tags_knowledge_item_id_topic_tag_id_pk" PRIMARY KEY("knowledge_item_id","topic_tag_id")
);
--> statement-breakpoint
CREATE TABLE "topic_tag_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"topic_tag_id" integer NOT NULL,
	"alias" text NOT NULL,
	"normalized_alias" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "topic_tag_aliases_normalized_alias_unique" UNIQUE("normalized_alias")
);
--> statement-breakpoint
CREATE TABLE "topic_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"canonical_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "topic_tags_normalized_name_unique" UNIQUE("normalized_name")
);
--> statement-breakpoint
ALTER TABLE "knowledge_item_topic_tags" ADD CONSTRAINT "knowledge_item_topic_tags_knowledge_item_id_knowledge_items_id_fk" FOREIGN KEY ("knowledge_item_id") REFERENCES "public"."knowledge_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item_topic_tags" ADD CONSTRAINT "knowledge_item_topic_tags_topic_tag_id_topic_tags_id_fk" FOREIGN KEY ("topic_tag_id") REFERENCES "public"."topic_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item_topic_tags" ADD CONSTRAINT "knowledge_item_topic_tags_source_snapshot_id_source_snapshots_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_tag_aliases" ADD CONSTRAINT "topic_tag_aliases_topic_tag_id_topic_tags_id_fk" FOREIGN KEY ("topic_tag_id") REFERENCES "public"."topic_tags"("id") ON DELETE cascade ON UPDATE no action;
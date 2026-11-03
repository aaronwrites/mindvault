CREATE TABLE "topic_tag_corrections" (
	"knowledge_item_id" integer NOT NULL,
	"topic_tag_id" integer NOT NULL,
	"choice" text NOT NULL,
	CONSTRAINT "topic_tag_corrections_knowledge_item_id_topic_tag_id_pk" PRIMARY KEY("knowledge_item_id","topic_tag_id")
);
--> statement-breakpoint
ALTER TABLE "topic_tag_corrections" ADD CONSTRAINT "topic_tag_corrections_knowledge_item_id_knowledge_items_id_fk" FOREIGN KEY ("knowledge_item_id") REFERENCES "public"."knowledge_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_tag_corrections" ADD CONSTRAINT "topic_tag_corrections_topic_tag_id_topic_tags_id_fk" FOREIGN KEY ("topic_tag_id") REFERENCES "public"."topic_tags"("id") ON DELETE cascade ON UPDATE no action;
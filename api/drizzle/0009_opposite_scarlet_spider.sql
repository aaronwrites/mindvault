CREATE TABLE "passage_embeddings" (
	"passage_id" integer PRIMARY KEY NOT NULL,
	"embedding" vector(768) NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"dimensions" integer NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "passage_embeddings" ADD CONSTRAINT "passage_embeddings_passage_id_passages_id_fk" FOREIGN KEY ("passage_id") REFERENCES "public"."passages"("id") ON DELETE cascade ON UPDATE no action;
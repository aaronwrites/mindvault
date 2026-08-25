CREATE TABLE "passages" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_snapshot_id" integer,
	"capture_context_id" integer,
	"origin" text NOT NULL,
	"text" text NOT NULL,
	"ordinal" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "passages_one_content_origin" CHECK ((
        (source_snapshot_id IS NOT NULL AND capture_context_id IS NULL AND origin = 'source-snapshot')
        OR (source_snapshot_id IS NULL AND capture_context_id IS NOT NULL AND origin IN ('selected-source-text', 'personal-note'))
    ))
);
--> statement-breakpoint
ALTER TABLE "passages" ADD CONSTRAINT "passages_source_snapshot_id_source_snapshots_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passages" ADD CONSTRAINT "passages_capture_context_id_capture_contexts_id_fk" FOREIGN KEY ("capture_context_id") REFERENCES "public"."capture_contexts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "passages_source_snapshot_ordinal_unique" ON "passages" USING btree ("source_snapshot_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "passages_capture_context_ordinal_unique" ON "passages" USING btree ("capture_context_id","ordinal");
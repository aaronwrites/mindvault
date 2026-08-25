ALTER TABLE "sources" ADD COLUMN "current_snapshot_id" integer;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_current_snapshot_id_source_snapshots_id_fk" FOREIGN KEY ("current_snapshot_id") REFERENCES "public"."source_snapshots"("id") ON DELETE SET NULL ON UPDATE no action;

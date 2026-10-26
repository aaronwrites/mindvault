ALTER TABLE "extracted_sources" ALTER COLUMN "original_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "extracted_sources" ALTER COLUMN "final_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "source_snapshots" ALTER COLUMN "original_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "source_snapshots" ALTER COLUMN "final_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "extracted_sources" ADD COLUMN "pdf_evidence" jsonb;--> statement-breakpoint
ALTER TABLE "passages" ADD COLUMN "page_number" integer;--> statement-breakpoint
ALTER TABLE "source_snapshots" ADD COLUMN "pdf_evidence" jsonb;--> statement-breakpoint
ALTER TABLE "passages" ADD CONSTRAINT "passages_page_reference" CHECK ("passages"."page_number" IS NULL OR ("passages"."page_number" > 0 AND "passages"."source_snapshot_id" IS NOT NULL));
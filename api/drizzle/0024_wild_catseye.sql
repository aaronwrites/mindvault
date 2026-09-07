ALTER TABLE "source_preview_media" ADD COLUMN "presentation" text DEFAULT 'cover' NOT NULL;--> statement-breakpoint
UPDATE "source_preview_media" AS media
SET "presentation" = 'icon'
FROM "source_previews" AS preview
WHERE media."source_snapshot_id" = preview."source_snapshot_id"
  AND media."source_url" = preview."favicon_url"
  AND (preview."preview_image_url" IS NULL OR media."source_url" IS DISTINCT FROM preview."preview_image_url");--> statement-breakpoint
ALTER TABLE "source_preview_media" ADD CONSTRAINT "source_preview_media_presentation" CHECK ("source_preview_media"."presentation" IN ('cover', 'icon'));

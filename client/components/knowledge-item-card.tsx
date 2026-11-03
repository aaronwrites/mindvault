import { ImageTitleCard } from "@/components/image-title-card";
import { CardHoverSummary } from "@/components/card-hover-summary";
import { originalFileTitle, sourcePreviewTitle } from "@/components/source-preview";
import { knowledgeItemCardDescription } from "@/lib/knowledge-item-card-content";
import { knowledgeItemCardStatus } from "@/lib/knowledge-item-status";
import type { KnowledgeItem } from "@/lib/types";

export function knowledgeItemTitle(item: KnowledgeItem) {
  return item.title ?? item.customTitle ?? (item.source.filename !== undefined
    ? originalFileTitle(item.source.filename, item.source.kind)
    : sourcePreviewTitle(item.sourcePreview, item.source.submittedUrl));
}

export function isItemProcessing(item: KnowledgeItem) {
  return item.availability === "processing" || item.noteIndexing === "processing" || item.latestAttempt?.status === "pending" || item.latestAttempt?.status === "running";
}

export function itemHasLimitations(item: KnowledgeItem) {
  return item.availability === "needs-attention" || item.availability === "unsupported" ||
    item.noteIndexing === "incomplete" || (item.source.filename !== undefined && item.source.kind !== "pdf") || item.latestAttempt?.status === "unsupported" ||
    item.organizationCondition === "incomplete" || item.latestAttempt?.status === "failed" ||
    Boolean(item.latestAttempt?.warnings?.length) || item.evidenceCoverage === "metadata-only" ||
    // PDF text extraction never establishes understanding of visual relationships.
    Boolean(item.extractionCoverage);
}

export function KnowledgeItemCard({ knowledgeItem: item, onOpen, onTrash }: {
  knowledgeItem: KnowledgeItem;
  onOpen: (id: number) => void;
  onTrash?: (id: number, title: string) => void;
}) {
  const title = knowledgeItemTitle(item);
  const description = knowledgeItemCardDescription(item);
  const status = knowledgeItemCardStatus(item);
  return (
    <ImageTitleCard item={item} title={title} onOpen={onOpen} onTrash={item.lifecycleState === "active" ? onTrash : undefined}>
      <CardHoverSummary status={item.lifecycleState === "pending-permanent-deletion" ? item.deletion?.status === "failed" ? "Deletion failed" : "Deleting" : status.label}
        summary={description?.label === "TL;DR" ? description.text : null} />
    </ImageTitleCard>
  );
}

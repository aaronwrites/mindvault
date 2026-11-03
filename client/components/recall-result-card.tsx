import { CardHoverSummary } from "@/components/card-hover-summary";
import { ImageTitleCard } from "@/components/image-title-card";
import { knowledgeItemTitle } from "@/components/knowledge-item-card";
import { originalFileTitle, sourcePreviewTitle } from "@/components/source-preview";
import { knowledgeItemCardDescription } from "@/lib/knowledge-item-card-content";
import { knowledgeItemCardStatus } from "@/lib/knowledge-item-status";
import type { KnowledgeItem, RecallKnowledgeItem } from "@/lib/types";

export function RecallResultCard({ result, knowledgeItem, onOpen, onTrash }: {
  result: RecallKnowledgeItem;
  knowledgeItem?: KnowledgeItem;
  onOpen?: (id: number) => void;
  onTrash?: (id: number, title: string) => void;
}) {
  const title = result.title ?? (knowledgeItem ? knowledgeItemTitle(knowledgeItem) : result.source.filename !== undefined ? originalFileTitle(result.source.filename, result.source.kind) : sourcePreviewTitle(result.sourcePreview, result.source.submittedUrl));
  const description = knowledgeItem ? knowledgeItemCardDescription(knowledgeItem) : null;
  // Recall returns Ready items. Use the loaded library for summary provenance
  // and current availability without issuing another request for every result.
  const status = knowledgeItem ? knowledgeItemCardStatus(knowledgeItem).label : "Ready";
  return <ImageTitleCard item={result} title={title} onOpen={onOpen} onTrash={onTrash}>
    <CardHoverSummary status={status} summary={description?.label === "TL;DR" ? description.text : null} />
    <section aria-label="Matching excerpts" className="sr-only">
      {result.excerpts.map((excerpt, index) => <p key={`${excerpt.origin}-${index}`}>{excerpt.text}</p>)}
    </section>
  </ImageTitleCard>;
}

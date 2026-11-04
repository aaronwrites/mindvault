import { ItemStatusBadge } from "@/components/card-hover-summary";
import { itemSourceName } from "@/components/image-title-card";
import { ItemQuickActions } from "@/components/item-quick-actions";
import { SourcePreviewMedia, originalFileTitle, sourcePreviewTitle } from "@/components/source-preview";
import { knowledgeItemTitle } from "@/components/knowledge-item-card";
import { knowledgeItemCardStatus } from "@/lib/knowledge-item-status";
import { PdfPageReference } from "@/components/pdf-page-reference";
import { PdfExtractionCoverage } from "@/components/pdf-extraction-coverage";
import { Button } from "@/components/ui/button";
import type { KnowledgeItem, RecallKnowledgeItem } from "@/lib/types";

export function RecallResultCard({ result, knowledgeItem, onOpen, onTrash }: {
  result: RecallKnowledgeItem;
  knowledgeItem?: KnowledgeItem;
  onOpen?: (id: number) => void;
  onTrash?: (id: number, title: string) => void;
}) {
  const title = result.title ?? (knowledgeItem ? knowledgeItemTitle(knowledgeItem) : result.source.filename !== undefined ? originalFileTitle(result.source.filename, result.source.kind) : sourcePreviewTitle(result.sourcePreview, result.source.submittedUrl));
  return <article className="recall-result">
    {result.source.filename === undefined && result.sourcePreview?.previewImageUrl && <div className="result-thumbnail"><SourcePreviewMedia preview={result.sourcePreview} /></div>}
    <div className="result-content min-w-0 flex-1">
      <p className="card-source">{itemSourceName(result)}</p>
      <h3><Button variant="link" className="result-title" onClick={() => onOpen?.(result.id)} aria-label={`View ${title}`}>{title}</Button></h3>
      <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ItemStatusBadge status={knowledgeItem ? knowledgeItemCardStatus(knowledgeItem).label : "Ready"} />
        {knowledgeItem?.organizationCondition === "incomplete" && <span className="text-xs text-muted-foreground">Organization incomplete</span>}
      </div>
      <section aria-label="Matching excerpts" className="matching-excerpts">
        {result.excerpts.map((excerpt, index) => <div key={`${excerpt.origin}-${index}`} className="space-y-2">
          <blockquote>{excerpt.text}</blockquote>
          <PdfPageReference pageNumber={excerpt.pageNumber} pageLabel={excerpt.pageLabel} openOriginalFile={excerpt.openOriginalFile} />
          <PdfExtractionCoverage coverage={excerpt.sourceSnapshot?.extractionCoverage} />
          {excerpt.origin === "personal-note" && <p className="text-xs text-muted-foreground">From your personal note.</p>}
          {excerpt.origin === "selected-source-text" && <p className="text-xs text-muted-foreground">From selected source text.</p>}
          {excerpt.sourceSnapshot?.evidenceCoverage === "metadata-only" && <p className="text-xs text-muted-foreground">Based only on the website’s description, not the full content.</p>}
        </div>)}
      </section>
    </div>
    {onTrash && <ItemQuickActions item={result} title={title} onTrash={onTrash} />}
  </article>;
}

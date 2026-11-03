import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SourcePreviewMedia, originalFileTitle, sourceKindLabel, sourcePreviewTitle } from "@/components/source-preview";
import type { KnowledgeItem } from "@/lib/types";

export function knowledgeItemTitle(item: KnowledgeItem) {
  return item.source.filename !== undefined
    ? originalFileTitle(item.source.filename, item.source.kind)
    : sourcePreviewTitle(item.sourcePreview, item.source.submittedUrl);
}

export function isItemProcessing(item: KnowledgeItem) {
  return item.availability === "processing" || (item.availability === "ready" && item.organizationCondition === "processing") || item.latestAttempt?.status === "pending" || item.latestAttempt?.status === "running";
}

export function itemHasLimitations(item: KnowledgeItem) {
  return item.availability === "needs-attention" || item.availability === "unsupported" ||
    item.organizationCondition === "incomplete" || item.latestAttempt?.status === "failed" ||
    Boolean(item.latestAttempt?.warnings?.length) || item.evidenceCoverage === "metadata-only" ||
    // PDF text extraction never establishes understanding of visual relationships.
    Boolean(item.extractionCoverage);
}

export function KnowledgeItemCard({ knowledgeItem: item, onOpen }: {
  knowledgeItem: KnowledgeItem;
  onOpen: (id: number) => void;
}) {
  const title = knowledgeItemTitle(item);
  const processing = isItemProcessing(item);
  const limited = itemHasLimitations(item);
  return (
    <Card className="relative mb-4 break-inside-avoid">
      <Button variant="ghost" className="absolute inset-0 z-10 size-full rounded-[inherit]" aria-label={`View ${title}`} onClick={() => onOpen(item.id)} />
      {item.sourcePreview?.previewImageUrl && <SourcePreviewMedia preview={item.sourcePreview} />}
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <h3 className="break-words text-lg font-medium">{title}</h3>
          {(processing || limited) && <span role="status" aria-label={processing ? "Processing saved content" : "Details need attention or have limitations"} className={`mt-2 size-2 shrink-0 rounded-full ${processing ? "bg-muted-foreground motion-safe:animate-pulse" : "bg-amber-600"}`} />}
        </div>
        {item.source.filename !== undefined && <p className="text-sm text-muted-foreground">{sourceKindLabel(item.source.kind)}</p>}
        {(item.sourcePreview?.description || item.recognitionSummary) && <p className="line-clamp-4 text-sm text-muted-foreground">{item.sourcePreview?.description ?? item.recognitionSummary}</p>}
        {item.topicTags.length > 0 && <div aria-label="Tags" className="flex flex-wrap gap-2">{item.topicTags.slice(0, 4).map(tag => <Badge key={tag} variant="secondary">{tag}</Badge>)}</div>}
      </CardContent>
    </Card>
  );
}

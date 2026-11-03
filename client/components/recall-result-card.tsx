import { ItemQuickActions } from "@/components/item-quick-actions";
import { PdfPageReference } from "@/components/pdf-page-reference";
import { PdfExtractionCoverage } from "@/components/pdf-extraction-coverage";
import { API_URL } from "@/lib/api";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RecallKnowledgeItem } from "@/lib/types";
import { SourcePreviewFacts, SourcePreviewMedia, originalFileTitle, sourcePreviewTitle } from "@/components/source-preview";

const originLabels = {
  "source-snapshot": "Saved text",
  "selected-source-text": "Selected text",
  "personal-note": "Your note",
} as const;

export function RecallResultCard({ result, onOpen, onTrash }: { result: RecallKnowledgeItem; onOpen?: (id: number) => void; onTrash?: (id: number, title: string) => void }) {
  const title = result.title ?? (result.source.filename !== undefined ? originalFileTitle(result.source.filename, result.source.kind) : sourcePreviewTitle(result.sourcePreview, result.source.submittedUrl));
  return (
    <Card className="group/card relative mb-4 break-inside-avoid" onClick={event => {
      // Let links and buttons perform their own actions; text above the
      // full-card button should still open the same details.
      if (event.target instanceof Element && !event.target.closest('a, button, input, textarea, select, [role="button"]')) {
        onOpen?.(result.id);
      }
    }}>
      {onOpen && <Button variant="ghost" className="absolute inset-0 z-10 size-full rounded-[inherit]" aria-label={`View ${title}`} onClick={() => onOpen(result.id)} />}
      <SourcePreviewMedia preview={result.sourcePreview} />
      <CardHeader>
        <CardTitle><h3 className="break-words text-lg font-medium">{title}</h3></CardTitle>
        <CardAction className="relative z-20">
          {onTrash && <ItemQuickActions item={result} title={title} onTrash={onTrash} />}
          {onOpen && <Button variant="outline" onClick={() => onOpen(result.id)}>View details</Button>}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open original"
            render={<a href={result.source.originalFileActions?.open ? `${API_URL}${result.source.originalFileActions.open}` : result.excerpts[0]?.sourceSnapshot?.originalUrl ?? result.source.submittedUrl} target="_blank" rel="noreferrer" />}
            nativeButton={false}
          >
            <ExternalLink />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <section aria-label="Source preview" className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Original details</p>
          {result.source.filename !== undefined ? <p>{result.source.filename} · {result.source.mediaType}</p> : <SourcePreviewFacts preview={result.sourcePreview} submittedUrl={result.source.submittedUrl} />}
        </section>
        <section aria-label="Matching excerpts" className="space-y-3">
          {result.excerpts.map((excerpt, index) => (
            <blockquote key={`${excerpt.origin}-${index}`} className="relative z-20 space-y-1 border-l-2 pl-3 text-sm">
              <p>{excerpt.text}</p>
              <PdfPageReference pageNumber={excerpt.pageNumber} pageLabel={excerpt.pageLabel} openOriginalFile={excerpt.openOriginalFile} />
              <PdfExtractionCoverage coverage={excerpt.sourceSnapshot?.extractionCoverage} />
              <footer className="text-muted-foreground">{originLabels[excerpt.origin]}{excerpt.sourceSnapshot?.evidenceCoverage === "metadata-only" ? " · website description only" : ""}</footer>
            </blockquote>
          ))}
        </section>
        {result.recognitionSummary && (
          <section aria-label="Generated preview" className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Preview</p>
            <p className="text-sm text-muted-foreground">{result.recognitionSummary}</p>
          </section>
        )}
        <p className="break-all text-xs text-muted-foreground">{result.source.submittedUrl}</p>
        {result.topicTags.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Tags">
            {result.topicTags.map((tag) => <li key={tag}><Badge variant="secondary">{tag}</Badge></li>)}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

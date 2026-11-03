import { PdfPageReference } from "@/components/pdf-page-reference";
import { PdfExtractionCoverage } from "@/components/pdf-extraction-coverage";
import { API_URL } from "@/lib/api";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RecallKnowledgeItem } from "@/lib/types";
import { SourcePreviewFacts, SourcePreviewMedia, sourcePreviewTitle } from "@/components/source-preview";

const originLabels = {
  "source-snapshot": "Source Snapshot excerpt",
  "selected-source-text": "Selected text",
  "personal-note": "Your note",
} as const;

export function RecallResultCard({ result, onOpen }: { result: RecallKnowledgeItem; onOpen?: (id: number) => void }) {
  return (
    <Card className="h-full">
      <SourcePreviewMedia preview={result.sourcePreview} />
      <CardHeader>
        <Badge variant="outline" className="w-fit">Grounded match</Badge>
        <CardTitle><h3>{result.source.filename ?? sourcePreviewTitle(result.sourcePreview, result.source.submittedUrl)}</h3></CardTitle>
        <CardAction>
          {onOpen && <Button variant="outline" onClick={() => onOpen(result.id)}>View details</Button>}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open original Source"
            render={<a href={result.source.originalFileActions?.open ? `${API_URL}${result.source.originalFileActions.open}` : result.excerpts[0]?.sourceSnapshot?.originalUrl ?? result.source.submittedUrl} target="_blank" rel="noreferrer" />}
            nativeButton={false}
          >
            <ExternalLink />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <section aria-label="Source preview" className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Source-provided details</p>
          {result.source.filename !== undefined ? <p>{result.source.filename} · {result.source.mediaType}</p> : <SourcePreviewFacts preview={result.sourcePreview} submittedUrl={result.source.submittedUrl} />}
        </section>
        <section aria-label="Grounded matching excerpts" className="space-y-3">
          {result.excerpts.map((excerpt, index) => (
            <blockquote key={`${excerpt.origin}-${index}`} className="space-y-1 border-l-2 pl-3 text-sm">
              <p>{excerpt.text}</p>
              <PdfPageReference pageNumber={excerpt.pageNumber} pageLabel={excerpt.pageLabel} openOriginalFile={excerpt.openOriginalFile} />
              <PdfExtractionCoverage coverage={excerpt.sourceSnapshot?.extractionCoverage} />
              <footer className="text-muted-foreground">{originLabels[excerpt.origin]}{excerpt.sourceSnapshot?.evidenceCoverage === "metadata-only" ? " · metadata-only evidence" : ""}</footer>
            </blockquote>
          ))}
        </section>
        {result.recognitionSummary && (
          <section aria-label="Generated Recognition Summary" className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Preview</p>
            <p className="text-sm text-muted-foreground">{result.recognitionSummary}</p>
          </section>
        )}
        <p className="break-all text-xs text-muted-foreground">{result.source.submittedUrl}</p>
        {result.topicTags.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Generated Topic Tags">
            {result.topicTags.map((tag) => <li key={tag}><Badge variant="secondary">{tag}</Badge></li>)}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

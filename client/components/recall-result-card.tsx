import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RecallKnowledgeItem } from "@/lib/types";

const originLabels = {
  "source-snapshot": "Source excerpt",
  "selected-source-text": "Selected text",
  "personal-note": "Your note",
} as const;

export function RecallResultCard({ result }: { result: RecallKnowledgeItem }) {
  return (
    <Card>
      <CardHeader>
        <Badge variant="outline" className="w-fit">Grounded match</Badge>
        <CardTitle><h3>{result.title ?? "Captured link"}</h3></CardTitle>
        <CardAction>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open original Source"
            render={<a href={result.excerpts[0]?.sourceSnapshot?.originalUrl ?? result.source.submittedUrl} target="_blank" rel="noreferrer" />}
            nativeButton={false}
          >
            <ExternalLink />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {result.recognitionSummary && (
          <section aria-label="Generated Recognition Summary" className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Generated recognition summary</p>
            <p className="text-sm text-muted-foreground">{result.recognitionSummary}</p>
          </section>
        )}
        {result.excerpts.map((excerpt, index) => (
          <blockquote key={`${excerpt.origin}-${index}`} className="space-y-1 border-l-2 pl-3 text-sm">
            <p>{excerpt.text}</p>
            <footer className="text-muted-foreground">{originLabels[excerpt.origin]}</footer>
          </blockquote>
        ))}
        <p className="break-all text-xs text-muted-foreground">{result.source.submittedUrl}</p>
        {result.topicTags.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Topic Tags">
            {result.topicTags.map((tag) => <li key={tag}><Badge variant="secondary">{tag}</Badge></li>)}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { KnowledgeItem } from "@/lib/types";

const labels = {
  processing: "Processing",
  ready: "Ready",
  unsupported: "Unsupported",
  "needs-attention": "Needs attention",
} as const;
export function KnowledgeItemCard({
  knowledgeItem,
}: {
  knowledgeItem: KnowledgeItem;
}) {
  const { source } = knowledgeItem;
  return (
    <Card className="h-full">
      <CardHeader>
        <Badge variant="outline" className="mb-1 w-fit">
          {labels[knowledgeItem.availability]}
        </Badge>
        <CardTitle className="text-lg leading-snug">
          <h3>Captured link</h3>
        </CardTitle>
        <CardAction>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Open ${source.submittedUrl}`}
            render={
              <a href={source.submittedUrl} target="_blank" rel="noreferrer" />
            }
            nativeButton={false}
          >
            <ExternalLink />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex-1 space-y-3">
        <p className="break-all text-sm text-muted-foreground">
          {source.submittedUrl}
        </p>
        {knowledgeItem.availability === "processing" && (
          <p className="text-sm text-muted-foreground">
            Capture succeeded. Processing continues in the background.
          </p>
        )}
        {knowledgeItem.latestAttempt && (
          <p className="text-sm text-muted-foreground">
            Latest attempt:{" "}
            {knowledgeItem.latestAttempt.kind.replaceAll("-", " ")} (
            {knowledgeItem.latestAttempt.status}).
          </p>
        )}
      </CardContent>
      {knowledgeItem.captureContexts.length > 0 && (
        <CardFooter>
          <ul className="space-y-1 text-sm" aria-label="Capture context">
            {knowledgeItem.captureContexts.map((context, index) => (
              <li key={`${context.kind}-${index}`}>
                <span className="font-medium">
                  {context.kind === "personal-note" ? "Note" : "Selected text"}:
                </span>{" "}
                {context.summary}
              </li>
            ))}
          </ul>
        </CardFooter>
      )}
    </Card>
  );
}

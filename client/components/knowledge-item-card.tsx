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
  onRefresh,
  isRefreshing = false,
}: {
  knowledgeItem: KnowledgeItem;
  onRefresh: (knowledgeItemId: number) => void;
  isRefreshing?: boolean;
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
        {knowledgeItem.availability === "ready" && knowledgeItem.latestAttempt?.kind === "refresh" &&
          (knowledgeItem.latestAttempt.status === "pending" || knowledgeItem.latestAttempt.status === "running") && (
            <p className="text-sm text-muted-foreground">
              Refresh underway. Your Ready content remains available.
            </p>
          )}
        {knowledgeItem.availability === "ready" && knowledgeItem.latestAttempt?.kind === "refresh" &&
          knowledgeItem.latestAttempt.status === "failed" && (
            <p className="text-sm text-muted-foreground">
              Refresh could not update this Source. Your existing Ready content remains available.
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
      <CardFooter className="gap-3">
        <Button
          variant="outline"
          onClick={() => onRefresh(knowledgeItem.id)}
          disabled={isRefreshing}
        >
          {isRefreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </CardFooter>
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

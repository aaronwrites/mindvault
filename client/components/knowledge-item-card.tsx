import { ExternalLink, Globe2 } from "lucide-react";
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
  onRetry,
  isRefreshing = false,
  isRetrying = false,
}: {
  knowledgeItem: KnowledgeItem;
  onRefresh: (knowledgeItemId: number) => void;
  onRetry: (knowledgeItemId: number) => void;
  isRefreshing?: boolean;
  isRetrying?: boolean;
}) {
  const { source } = knowledgeItem;
  const preview = knowledgeItem.sourcePreview;
  const hostname = readableHostname(source.submittedUrl);
  const retryIsActionable = knowledgeItem.latestAttempt?.status === "failed";
  return (
    <Card className="h-full">
      {preview?.previewImageUrl ? (
        // Retained API media is already bounded and validated; Next's optimizer cannot fetch this private API endpoint.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview.previewImageUrl}
          alt={preview.previewImageAlt ?? ""}
          className="aspect-[16/7] w-full object-cover"
        />
      ) : (
        <div
          role="img"
          aria-label="Webpage preview placeholder"
          className="flex aspect-[16/7] items-center justify-center bg-muted text-muted-foreground"
        >
          <Globe2 aria-hidden="true" className="size-10" />
        </div>
      )}
      <CardHeader>
        <Badge variant="outline" className="mb-1 w-fit">
          {labels[knowledgeItem.availability]}
        </Badge>
        <CardTitle className="text-lg leading-snug">
          <h3>{preview?.title ?? hostname}</h3>
        </CardTitle>
        <CardAction>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Open original webpage: ${source.submittedUrl}`}
            render={
              <a href={source.submittedUrl} target="_blank" rel="noopener noreferrer" />
            }
            nativeButton={false}
          >
            <ExternalLink />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex-1 space-y-3">
        <p className="text-sm font-medium text-muted-foreground">{displayContentType(preview?.contentType ?? "webpage")}</p>
        <p className="break-all text-sm text-muted-foreground">{preview?.websiteName ?? hostname}</p>
        {preview?.description && <p className="text-sm text-muted-foreground">{preview.description}</p>}
        {(preview?.author || preview?.publishedAt) && (
          <p className="text-sm text-muted-foreground">
            {[preview.author, preview.publishedAt ? formatPublicationDate(preview.publishedAt) : null].filter(Boolean).join(" · ")}
          </p>
        )}
        {knowledgeItem.recognitionSummary && (
          <section aria-label="Generated Recognition Summary" className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Generated recognition summary</p>
            <p className="text-sm text-muted-foreground">{knowledgeItem.recognitionSummary}</p>
          </section>
        )}
        {knowledgeItem.topicTags.length > 0 && (
          <section aria-label="Generated Topic Tags" className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Generated topic tags</p>
            <ul className="flex flex-wrap gap-2">
              {knowledgeItem.topicTags.map((tag) => <li key={tag}><Badge variant="secondary">{tag}</Badge></li>)}
            </ul>
          </section>
        )}
        {knowledgeItem.availability === "processing" && (
          <p className="text-sm text-muted-foreground">
            Capture succeeded. Processing continues in the background.
          </p>
        )}
        {knowledgeItem.availability === "needs-attention" && (
          <p className="text-sm text-muted-foreground">
            Processing needs attention{knowledgeItem.latestAttempt?.failureReason ? `: ${knowledgeItem.latestAttempt.failureReason}` : "."}
          </p>
        )}
        {knowledgeItem.organizationCondition === "incomplete" && (
          <p className="text-sm text-muted-foreground">
            Organization is incomplete. Topic Tag generation needs attention, but your Ready content remains available.
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
        {knowledgeItem.availability === "ready" && knowledgeItem.latestAttempt?.kind === "manual-retry" &&
          (knowledgeItem.latestAttempt.status === "pending" || knowledgeItem.latestAttempt.status === "running") && (
            <p className="text-sm text-muted-foreground">
              Retrying failed processing. Your Ready content remains available.
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
        {knowledgeItem.availability === "ready" && !retryIsActionable && (
          <Button
            variant="outline"
            onClick={() => onRefresh(knowledgeItem.id)}
            disabled={isRefreshing}
          >
            {isRefreshing ? "Refreshing…" : "Refresh"}
          </Button>
        )}
        {retryIsActionable && (
          <Button
            variant="outline"
            onClick={() => onRetry(knowledgeItem.id)}
            disabled={isRetrying}
          >
            {isRetrying ? "Retrying…" : "Retry processing"}
          </Button>
        )}
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

function readableHostname(address: string) {
  try {
    return new URL(address).hostname;
  } catch {
    return address;
  }
}

function displayContentType(value: string) {
  return value.replaceAll(/[-_]/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function formatPublicationDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  }).format(date);
}

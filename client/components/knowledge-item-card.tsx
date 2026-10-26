import { PdfExtractionCoverage } from "@/components/pdf-extraction-coverage";
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
import { API_URL } from "@/lib/api";
import { OriginalFilePlaceholder, SourcePreviewFacts, SourcePreviewMedia, formatByteSize, originalFileTitle, sourceKindLabel, sourcePreviewTitle } from "@/components/source-preview";

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
  onTrash,
  onRestore,
  onPermanentlyDelete,
  isRefreshing = false,
  isRetrying = false,
  isTrashing = false,
  isRestoring = false,
  isPermanentlyDeleting = false,
}: {
  knowledgeItem: KnowledgeItem;
  onRefresh: (knowledgeItemId: number) => void;
  onRetry: (knowledgeItemId: number) => void;
  onTrash: (knowledgeItemId: number) => void;
  onRestore: (knowledgeItemId: number) => void;
  onPermanentlyDelete: (knowledgeItem: KnowledgeItem) => void;
  isRefreshing?: boolean;
  isRetrying?: boolean;
  isTrashing?: boolean;
  isRestoring?: boolean;
  isPermanentlyDeleting?: boolean;
}) {
  const { source } = knowledgeItem;
  const preview = knowledgeItem.sourcePreview;
  const isOriginalFile = source.filename !== undefined;
  const canProcess = !isOriginalFile || source.kind === "pdf";
  const retryIsActionable = knowledgeItem.latestAttempt?.status === "failed";
  const originalFileTitleText = isOriginalFile ? originalFileTitle(source.filename, source.kind) : null;
  return (
    <Card className="h-full">
      {isOriginalFile ? <OriginalFilePlaceholder sourceKind={source.kind} /> : <SourcePreviewMedia preview={preview} />}
      <CardHeader>
        <Badge variant="outline" className="mb-1 w-fit">
          {labels[knowledgeItem.availability]}
        </Badge>
        <CardTitle className="text-lg leading-snug">
          <h3>{originalFileTitleText ?? sourcePreviewTitle(preview, source.submittedUrl!)}</h3>
        </CardTitle>
        {isOriginalFile && source.originalFileActions && <CardAction className="flex gap-1">
          {source.originalFileActions.open && <Button
            variant="ghost"
            size="icon"
            aria-label={`Open original file: ${originalFileTitleText}`}
            render={<a href={`${API_URL}${source.originalFileActions.open}`} target="_blank" rel="noopener noreferrer" />}
            nativeButton={false}
          >
            <ExternalLink />
          </Button>}
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Download original file: ${originalFileTitleText}`}
            render={<a href={`${API_URL}${source.originalFileActions.download}`} target="_blank" rel="noopener noreferrer" />}
            nativeButton={false}
          >
            Download
          </Button>
        </CardAction>}
        {!isOriginalFile && <CardAction>
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
        </CardAction>}
      </CardHeader>
      <CardContent className="flex-1 space-y-3">
        {knowledgeItem.lifecycleState === "trashed" && <p className="text-sm text-muted-foreground" role="status">In Trash{knowledgeItem.trashedAt ? ` since ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(knowledgeItem.trashedAt))}` : ""}. Restore it to return it to your active Knowledge Items.</p>}
        {knowledgeItem.lifecycleState === "pending-permanent-deletion" && <p className="text-sm text-muted-foreground" role="status">{knowledgeItem.deletion?.status === "failed" ? `Deletion needs attention${knowledgeItem.deletion.failureReason ? `: ${knowledgeItem.deletion.failureReason}` : "."}` : "Deletion pending. This Knowledge Item cannot be restored while MindVault securely removes its retained Original File."}</p>}
        {isOriginalFile ? <section aria-label="Original File details" className="space-y-1 text-sm text-muted-foreground">
          <p className="font-medium">{sourceKindLabel(source.kind)}</p>
          {source.mediaType && <p>{source.mediaType}</p>}
          {formatByteSize(source.byteSize) && <p>{formatByteSize(source.byteSize)}</p>}
          <p>Captured {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(knowledgeItem.createdAt))}</p>
        </section> : <SourcePreviewFacts preview={preview} submittedUrl={source.submittedUrl!} />}
        {!isOriginalFile && knowledgeItem.evidenceCoverage === "metadata-only" && (
          <p className="text-sm text-muted-foreground" role="status">
            Searchable from source-provided metadata only; primary page content was unavailable.
          </p>
        )}
        <PdfExtractionCoverage coverage={knowledgeItem.extractionCoverage} />
        {canProcess && knowledgeItem.recognitionSummary && (
          <section aria-label="Generated Recognition Summary" className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Generated recognition summary</p>
            <p className="text-sm text-muted-foreground">{knowledgeItem.recognitionSummary}</p>
          </section>
        )}
        {canProcess && knowledgeItem.topicTags.length > 0 && (
          <section aria-label="Generated Topic Tags" className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Generated topic tags</p>
            <ul className="flex flex-wrap gap-2">
              {knowledgeItem.topicTags.map((tag) => <li key={tag}><Badge variant="secondary">{tag}</Badge></li>)}
            </ul>
          </section>
        )}
        {canProcess && knowledgeItem.availability === "processing" && (
          <p className="text-sm text-muted-foreground">
            Capture succeeded. Processing continues in the background.
          </p>
        )}
        {canProcess && knowledgeItem.availability === "needs-attention" && (
          <p className="text-sm text-muted-foreground">
            Processing needs attention{knowledgeItem.latestAttempt?.failureReason ? `: ${knowledgeItem.latestAttempt.failureReason}` : "."}
          </p>
        )}
        {canProcess && knowledgeItem.organizationCondition === "incomplete" && (
          <p className="text-sm text-muted-foreground">
            Organization is incomplete. Topic Tag generation needs attention, but your Ready content remains available.
          </p>
        )}
        {canProcess && knowledgeItem.availability === "ready" && knowledgeItem.latestAttempt?.kind === "refresh" &&
          (knowledgeItem.latestAttempt.status === "pending" || knowledgeItem.latestAttempt.status === "running") && (
            <p className="text-sm text-muted-foreground">
              Refresh underway. Your Ready content remains available.
            </p>
          )}
        {canProcess && knowledgeItem.availability === "ready" && knowledgeItem.latestAttempt?.kind === "refresh" &&
          knowledgeItem.latestAttempt.status === "failed" && (
            <p className="text-sm text-muted-foreground">
              Refresh could not update this Source. Your existing Ready content remains available.
            </p>
          )}
        {canProcess && knowledgeItem.availability === "ready" && knowledgeItem.latestAttempt?.kind === "manual-retry" &&
          (knowledgeItem.latestAttempt.status === "pending" || knowledgeItem.latestAttempt.status === "running") && (
            <p className="text-sm text-muted-foreground">
              Retrying failed processing. Your Ready content remains available.
            </p>
          )}
        {knowledgeItem.latestAttempt?.warnings?.map(warning => <p key={warning} className="text-sm text-muted-foreground" role="status">{warning}</p>)}
        {canProcess && knowledgeItem.latestAttempt && (
          <p className="text-sm text-muted-foreground">
            Latest attempt:{" "}
            {knowledgeItem.latestAttempt.kind.replaceAll("-", " ")} (
            {knowledgeItem.latestAttempt.status}).
          </p>
        )}
      </CardContent>
      <CardFooter className="gap-3">
        {knowledgeItem.lifecycleState === "trashed" ? <>
          <Button variant="outline" onClick={() => onRestore(knowledgeItem.id)} disabled={isRestoring}>{isRestoring ? "Restoring…" : "Restore"}</Button>
          <Button variant="destructive" onClick={() => onPermanentlyDelete(knowledgeItem)} disabled={isPermanentlyDeleting}>{isPermanentlyDeleting ? "Deleting…" : "Delete permanently"}</Button>
        </> : knowledgeItem.lifecycleState === "pending-permanent-deletion" ? knowledgeItem.deletion?.status === "failed" ? <Button variant="outline" onClick={() => onPermanentlyDelete(knowledgeItem)} disabled={isPermanentlyDeleting}>{isPermanentlyDeleting ? "Retrying…" : "Retry deletion"}</Button> : null : <>
        {isOriginalFile && source.kind === "pdf" && knowledgeItem.availability === "unsupported" && (
          <Button variant="outline" onClick={() => onRefresh(knowledgeItem.id)} disabled={isRefreshing}>
            {isRefreshing ? "Starting…" : "Process PDF"}
          </Button>
        )}
        {canProcess && knowledgeItem.availability === "ready" && !retryIsActionable && (
          <Button
            variant="outline"
            onClick={() => onRefresh(knowledgeItem.id)}
            disabled={isRefreshing}
          >
            {isRefreshing ? "Refreshing…" : "Refresh"}
          </Button>
        )}
        {canProcess && retryIsActionable && (
          <Button
            variant="outline"
            onClick={() => onRetry(knowledgeItem.id)}
            disabled={isRetrying}
          >
            {isRetrying ? "Retrying…" : "Retry processing"}
          </Button>
        )}
        <Button variant="ghost" onClick={() => onTrash(knowledgeItem.id)} disabled={isTrashing}>{isTrashing ? "Moving to Trash…" : "Move to Trash"}</Button>
        </>}
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

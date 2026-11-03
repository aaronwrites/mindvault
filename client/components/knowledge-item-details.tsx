import { useState } from "react";
import { PdfExtractionCoverage } from "@/components/pdf-extraction-coverage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OriginalFilePlaceholder, SourcePreviewFacts, SourcePreviewMedia, formatByteSize } from "@/components/source-preview";
import { isItemProcessing, itemHasLimitations, knowledgeItemTitle } from "@/components/knowledge-item-card";
import { API_URL } from "@/lib/api";
import type { KnowledgeItem } from "@/lib/types";

export type KnowledgeItemActions = {
  onRefresh: (id: number) => void;
  onRetry: (id: number) => void;
  onTrash: (id: number) => void;
  onRestore: (id: number) => void;
  onPermanentlyDelete: (item: KnowledgeItem) => void;
  isRefreshing?: boolean;
  isRetrying?: boolean;
  isTrashing?: boolean;
  isRestoring?: boolean;
  isPermanentlyDeleting?: boolean;
};

export function KnowledgeItemDetails({ knowledgeItem: item, ...actions }: { knowledgeItem: KnowledgeItem } & KnowledgeItemActions) {
  const limited = itemHasLimitations(item);
  const [expanded, setExpanded] = useState(limited);
  const { source } = item;
  const file = source.filename !== undefined;
  const canProcess = !file || source.kind === "pdf";
  const processing = isItemProcessing(item);
  const failed = item.latestAttempt?.status === "failed";
  const failureReason = item.latestAttempt?.failureReason?.toLowerCase() ?? "";
  const recovery = /encrypt|password/.test(failureReason)
    ? "This PDF is password protected. Save an unlocked copy to make its text searchable."
    : /authenticat|sign.in|http (401|403)/.test(failureReason)
      ? "The website requires sign-in or blocks access. Try saving a PDF copy of the content instead."
      : "We couldn’t prepare this for search. Try processing it again.";
  const title = knowledgeItemTitle(item);
  const openUrl = file ? source.originalFileActions?.open && `${API_URL}${source.originalFileActions.open}` : source.submittedUrl;
  return <div className="space-y-6">
    {file ? <OriginalFilePlaceholder sourceKind={source.kind} /> : <SourcePreviewMedia preview={item.sourcePreview} />}
    <div className="flex flex-wrap gap-2">
      {openUrl && <Button variant="outline" render={<a href={openUrl} target="_blank" rel="noopener noreferrer" />} nativeButton={false}>Open original</Button>}
      {source.originalFileActions && <Button variant="outline" aria-label={`Download original file: ${title}`} render={<a href={`${API_URL}${source.originalFileActions.download}`} target="_blank" rel="noopener noreferrer" />} nativeButton={false}>Download</Button>}
    </div>
    <section aria-label="Preview" className="space-y-2">
      <h3 className="font-medium">Preview</h3>
      <p className="text-sm text-muted-foreground">{item.recognitionSummary ?? item.sourcePreview?.description ?? (processing ? "Your save is safe. A preview is being prepared." : "No text preview is available yet.")}</p>
      {item.recognitionSummary && <p className="text-xs text-muted-foreground">Generated description of available information.</p>}
      {item.evidenceCoverage === "metadata-only" && <p className="text-sm text-muted-foreground">Only the website’s description was available. This preview does not describe the full page content.</p>}
      {item.extractionCoverage && <p className="text-sm text-muted-foreground">This preview uses available PDF text. It may omit unread pages and does not interpret diagrams or charts. See Details for coverage.</p>}
    </section>
    {item.topicTags.length > 0 && <section aria-label="Tags"><h3 className="mb-2 font-medium">Tags</h3><ul className="flex flex-wrap gap-2">{item.topicTags.map(tag => <li key={tag}><Badge variant="secondary">{tag}</Badge></li>)}</ul></section>}
    {item.captureContexts.length > 0 && <section aria-label="Saved notes and selections" className="space-y-2">{item.captureContexts.map((context, index) => <p key={index} className="text-sm"><span className="font-medium">{context.kind === "personal-note" ? "Your note" : "Selected text"}: </span>{context.summary}</p>)}</section>}
    <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)} className="space-y-3 border-t pt-4">
      <summary className="cursor-pointer font-medium">Details</summary>
      <p className="text-sm text-muted-foreground">Saved {new Date(item.createdAt).toLocaleString()}</p>
      {file ? <p className="break-words text-sm text-muted-foreground">{title} · {source.mediaType}{formatByteSize(source.byteSize) && ` · ${formatByteSize(source.byteSize)}`}</p> : <SourcePreviewFacts preview={item.sourcePreview} submittedUrl={source.submittedUrl} />}
      <PdfExtractionCoverage coverage={item.extractionCoverage} />
      {processing && <p role="status" className="text-sm">{item.availability === "ready" ? "Updating in the background. Your saved content is still searchable." : "Your save is safe. We’re preparing it for search."}</p>}
      {item.availability === "needs-attention" && <p className="text-sm">{recovery}</p>}
      {item.availability === "unsupported" && <p className="text-sm">{file && source.kind === "pdf" ? "This saved PDF has not been processed yet. Choose Process PDF to make its text searchable." : source.kind === "pdf" ? "This PDF link is safely saved. Upload a copy of the PDF to make its text searchable." : "This is safely saved, but we can’t read this type of content yet."}</p>}
      {item.availability === "ready" && failed && <p className="text-sm">The latest update didn’t finish. Previously saved content is still searchable. You can try again.</p>}
      {item.organizationCondition === "incomplete" && <p className="text-sm">Automatic tagging didn’t finish. Available content is still searchable.</p>}
      {Boolean(item.latestAttempt?.warnings?.length) && <p className="text-sm">Some automatic processing didn’t finish. The preview or tags may be incomplete. Refresh to try again.</p>}
      {file && !source.originalFileActions && <p className="text-sm">File access is temporarily unavailable. Please try again later.</p>}
      {item.lifecycleState === "trashed" && <p className="text-sm">In Trash. Restore this to include it in search again.</p>}
      {item.lifecycleState === "pending-permanent-deletion" && <p role="status" className="text-sm">{item.deletion?.status === "failed" ? "Deletion didn’t finish. You can retry it." : "Deletion is in progress. This can’t be restored while the file is being removed."}</p>}
      {item.lifecycleState === "active" && canProcess && <div className="flex flex-wrap gap-2">
        {failed ? <Button variant="outline" disabled={actions.isRetrying} onClick={() => actions.onRetry(item.id)}>{actions.isRetrying ? "Retrying…" : "Retry processing"}</Button> :
          (item.availability === "ready" || (file && source.kind === "pdf" && item.availability === "unsupported")) && <Button variant="outline" disabled={actions.isRefreshing || processing} onClick={() => actions.onRefresh(item.id)}>{actions.isRefreshing ? "Starting…" : item.availability === "unsupported" ? "Process PDF" : "Refresh"}</Button>}
      </div>}
    </details>
    <div className="flex flex-wrap gap-2 border-t pt-4">
      {item.lifecycleState === "active" ? <Button variant="ghost" disabled={actions.isTrashing} onClick={() => actions.onTrash(item.id)}>Move to Trash</Button> : item.lifecycleState === "trashed" ? <>
        <Button variant="outline" disabled={actions.isRestoring} onClick={() => actions.onRestore(item.id)}>Restore</Button>
        <Button variant="destructive" disabled={actions.isPermanentlyDeleting} onClick={() => actions.onPermanentlyDelete(item)}>Delete permanently</Button>
      </> : item.deletion?.status === "failed" && <Button variant="outline" disabled={actions.isPermanentlyDeleting} onClick={() => actions.onPermanentlyDelete(item)}>Retry deletion</Button>}
    </div>
  </div>;
}

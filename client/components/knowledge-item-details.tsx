import { ItemNotesEditor } from "@/components/item-notes-editor";
import { useState } from "react";
import { PdfExtractionCoverage } from "@/components/pdf-extraction-coverage";
import { ItemTagsEditor } from "@/components/item-tags-editor";
import { Button } from "@/components/ui/button";
import { SourcePreviewFacts, SourcePreviewMedia, formatByteSize } from "@/components/source-preview";
import { isItemProcessing, itemHasLimitations, knowledgeItemTitle } from "@/components/knowledge-item-card";
import { API_URL } from "@/lib/api";
import type { KnowledgeItem } from "@/lib/types";
import { ChevronDown, ExternalLink, Download, Trash2 } from "lucide-react";
import { OutlinedPanel } from "@/components/outlined-panel";
import { ItemStatusBadge } from "@/components/card-hover-summary";
import { ProcessingIndicator } from "@/components/processing-indicator";
import { knowledgeItemCardStatus } from "@/lib/knowledge-item-status";

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
  const [previouslyLimited, setPreviouslyLimited] = useState(limited);
  if (previouslyLimited !== limited) {
    setPreviouslyLimited(limited);
    if (limited) setExpanded(true);
  }
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
  const provenance = item.recognitionSummaryProvenance;
  const tldr = Boolean(item.recognitionSummary && provenance?.contract === "tldr-v1" && provenance.isCurrent && provenance.evidenceCoverage === "primary-content");
  const summaryLabel = tldr ? "TL;DR" : "Preview";
  const summaryCoverage = provenance?.extractionCoverage ?? item.extractionCoverage;
  const title = knowledgeItemTitle(item);
  const openUrl = file ? source.originalFileActions?.open && `${API_URL}${source.originalFileActions.open}` : source.submittedUrl;
  return <div className="item-details">
    <aside className="item-source-column">
      {!file && item.sourcePreview?.previewImageUrl && <div className="detail-source-image"><SourcePreviewMedia preview={item.sourcePreview} /></div>}
      {file && <div className="document-preview"><p className="document-format">{source.kind.toUpperCase()} DOCUMENT</p><p className="document-filename">{source.filename}</p><p className="text-xs text-muted-foreground">{formatByteSize(source.byteSize)}</p></div>}
      <div className="item-source-strip">
      <div className="min-w-0 flex-1 space-y-2">
        <ItemStatusBadge expanded status={item.lifecycleState === "pending-permanent-deletion" ? item.deletion?.status === "failed" ? "Deletion failed" : "Deleting" : knowledgeItemCardStatus(item).label} />
        <p className="truncate text-sm text-muted-foreground">{file ? source.filename : item.sourcePreview?.websiteName ?? source.submittedUrl}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {openUrl && <Button render={<a href={openUrl} target="_blank" rel="noopener noreferrer" />} nativeButton={false}>Open original<ExternalLink aria-hidden="true" /></Button>}
        {source.originalFileActions && <Button variant="outline" aria-label={`Download original file: ${title}`} render={<a href={`${API_URL}${source.originalFileActions.download}`} target="_blank" rel="noopener noreferrer" />} nativeButton={false}><Download aria-hidden="true" />Download</Button>}
      </div>
    </div>
    </aside>
    <div className="item-reading-column">
    {processing && <ProcessingIndicator className="item-processing" label={item.availability === "ready" ? "Updating in the background. Saved content is still searchable." : "Safely saved. Preparing for search."} />}
    <OutlinedPanel title={summaryLabel} aria-label={summaryLabel} className="detail-summary">
      <p className="summary-copy">{item.recognitionSummary ?? item.sourcePreview?.description ?? (processing ? "Your save is safe. A preview is being prepared." : "No text preview is available yet.")}</p>
      {item.recognitionSummary && <p className="text-xs text-muted-foreground">{tldr ? "Generated from available source text." : "Generated description; a verified summary of the current content is not available yet."}</p>}
      {item.recognitionSummary && provenance && !provenance.isCurrent && <p className="text-sm text-muted-foreground">This preview describes an earlier saved version. The latest content is still searchable.</p>}
      {item.evidenceCoverage === "metadata-only" && <p className="text-sm text-muted-foreground">Only the website’s description was available. This preview does not describe the full page content.</p>}
      {summaryCoverage && <p className="text-sm text-muted-foreground">{summaryLabel} uses available PDF text. It may omit unread pages and does not interpret diagrams or charts. See Details for coverage.</p>}
      {provenance && !provenance.isCurrent && provenance.extractionCoverage && <PdfExtractionCoverage coverage={provenance.extractionCoverage} />}
    </OutlinedPanel>
    <div className="detail-workspace">
      <div className="detail-notes"><ItemNotesEditor item={item} /></div>
      <div className="detail-organization">
        <ItemTagsEditor item={item} />
      </div>
    </div>
    <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)} className="detail-metadata">
      <summary className="section-label flex cursor-pointer items-center gap-2 font-semibold">Details<ChevronDown aria-hidden="true" className="size-3.5" /></summary>
      <div className="space-y-3 pt-4">
      <p className="text-sm text-muted-foreground">Saved {new Date(item.createdAt).toLocaleString()}</p>
      {file ? <p className="break-words text-sm text-muted-foreground">{source.filename} · {source.mediaType}{formatByteSize(source.byteSize) && ` · ${formatByteSize(source.byteSize)}`}</p> : <SourcePreviewFacts preview={item.sourcePreview} submittedUrl={source.submittedUrl} />}
      <PdfExtractionCoverage coverage={item.extractionCoverage} />
      {processing && <p role="status" className="text-sm">{item.availability === "ready" ? "Updating in the background. Your saved content is still searchable." : "Your save is safe. We’re preparing it for search."}</p>}
      {item.availability === "needs-attention" && <p className="text-sm">{recovery}</p>}
      {item.availability === "ready" && ((file && source.kind !== "pdf") || item.latestAttempt?.status === "unsupported") && <p className="text-sm">Your notes are searchable, but we can’t read the original content yet.</p>}
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
      </div>
    </details>
    <div className="detail-footer">

      <div className="flex flex-wrap gap-2">
      {item.lifecycleState === "active" ? <Button variant="ghost" className="text-muted-foreground hover:text-destructive" disabled={actions.isTrashing} onClick={() => actions.onTrash(item.id)}><Trash2 aria-hidden="true" />{actions.isTrashing ? "Moving…" : "Move to Trash"}</Button> : item.lifecycleState === "trashed" ? <>
        <Button variant="outline" disabled={actions.isRestoring} onClick={() => actions.onRestore(item.id)}>Restore</Button>
        <Button variant="destructive" disabled={actions.isPermanentlyDeleting} onClick={() => actions.onPermanentlyDelete(item)}>Delete permanently</Button>
      </> : item.deletion?.status === "failed" && <Button variant="outline" disabled={actions.isPermanentlyDeleting} onClick={() => actions.onPermanentlyDelete(item)}>Retry deletion</Button>}
      </div>
    </div>
    </div>
  </div>;
}

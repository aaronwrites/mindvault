import type { KnowledgeItem } from "@/lib/types";

type CardStatus = {
  label: "Processing" | "Ready" | "Unsupported" | "Needs attention" | "In Trash";
  variant: "secondary" | "outline" | "destructive";
  detail: string | null;
};

function pdfCoverageDetail(coverage: NonNullable<KnowledgeItem["extractionCoverage"]>) {
  const extracted = coverage.pages.filter(page => page.outcome === "extracted").length;
  const partial = coverage.pages.length < coverage.pageCount || coverage.pages.some(page =>
    Boolean(page.reason) || (page.outcome !== "extracted" && page.outcome !== "blank"));

  if (extracted === 0) return "No PDF text extracted. Open details for coverage.";
  if (partial) return `Partial PDF text: ${extracted} of ${coverage.pageCount} pages extracted. Open details for coverage.`;
  return "PDF text available; diagrams and charts aren’t interpreted.";
}

// Availability is authoritative: background work and evidence gaps never revoke Ready.
// Show one secondary message, prioritizing recovery and work underway over scope
// disclosures and automatic organization. Full processing details remain on demand.
export function knowledgeItemCardStatus(item: KnowledgeItem): CardStatus {
  if (item.lifecycleState === "trashed") {
    return { label: "In Trash", variant: "outline", detail: "Excluded from search. Open details to restore." };
  }
  if (item.availability === "processing") {
    return { label: "Processing", variant: "secondary", detail: "Safely saved. Preparing for search." };
  }
  if (item.availability === "needs-attention") {
    return { label: "Needs attention", variant: "destructive", detail: "Not searchable yet. Open details for recovery options." };
  }
  if (item.availability === "unsupported") {
    return {
      label: "Unsupported", variant: "outline",
      detail: item.source.filename !== undefined
        ? item.source.kind === "pdf"
          ? "Original PDF retained. Open details to process its text."
          : "Original file retained; this content type can’t be read yet."
        : item.source.kind === "pdf"
          ? "PDF link saved. Upload the PDF to make its text searchable."
          : "Source saved; this content type can’t be read yet.",
    };
  }

  let detail: string | null = null;
  if (item.noteIndexing === "processing") {
    detail = "Updating note search; saved content is still searchable.";
  } else if (item.latestAttempt?.status === "pending" || item.latestAttempt?.status === "running") {
    detail = "Updating in the background; saved content is still searchable.";
  } else if (item.noteIndexing === "incomplete") {
    detail = "Note search incomplete. Open details to retry; other saved text is searchable.";
  } else if (item.latestAttempt?.status === "failed") {
    detail = "Update didn’t finish; saved content is still searchable. Open details to retry.";
  } else if ((item.source.filename !== undefined && item.source.kind !== "pdf") || item.latestAttempt?.status === "unsupported") {
    detail = "Saved text is searchable; the original content can’t be read yet.";
  } else if (item.extractionCoverage) {
    detail = pdfCoverageDetail(item.extractionCoverage);
  } else if (item.evidenceCoverage === "metadata-only") {
    detail = "Website description only; full page content wasn’t available.";
  } else if (item.organizationCondition === "incomplete") {
    detail = "Organization incomplete; saved content is still searchable.";
  } else if (item.latestAttempt?.warnings?.length) {
    detail = "Preview or tags may be incomplete; saved content is still searchable.";
  }
  return { label: "Ready", variant: "outline", detail };
}

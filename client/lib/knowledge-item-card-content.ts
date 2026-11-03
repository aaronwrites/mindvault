import type { KnowledgeItem } from "@/lib/types";

type CardDescription = {
  label: "TL;DR" | "Source Preview" | "Your note";
  text: string;
};

export function knowledgeItemCardDescription(item: KnowledgeItem): CardDescription | null {
  const summary = item.recognitionSummary?.trim();
  const provenance = item.recognitionSummaryProvenance;
  if (summary && provenance?.contract === "tldr-v1" && provenance.isCurrent && provenance.evidenceCoverage === "primary-content") {
    return { label: "TL;DR", text: summary };
  }

  const sourceDescription = item.sourcePreview?.description?.trim();
  if (sourceDescription) return { label: "Source Preview", text: sourceDescription };

  // Metadata can help recognition, but cannot establish what the full source says.
  if (summary && provenance?.contract === "preview-v1" && provenance.isCurrent && provenance.evidenceCoverage === "metadata-only") {
    return { label: "Source Preview", text: summary };
  }

  const note = item.captureContexts.find(context => context.kind === "personal-note" && context.text.trim());
  return note ? { label: "Your note", text: note.text.trim() } : null;
}

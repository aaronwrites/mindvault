import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { KnowledgeItemCard } from "@/components/knowledge-item-card";
import { knowledgeItemCardDescription } from "@/lib/knowledge-item-card-content";
import type { KnowledgeItem } from "@/lib/types";

const item: KnowledgeItem = {
  id: 1, createdAt: "2026-11-03T10:00:00Z", lifecycleState: "active", trashedAt: null,
  source: { id: 1, kind: "web", submittedUrl: "https://example.com/article", normalizedUrl: "https://example.com/article" },
  sourcePreview: {
    title: "Saved article", description: "Publisher introduction.", websiteName: "Example", author: null,
    publishedAt: null, contentType: null, previewImageUrl: null, previewImageAlt: null, faviconUrl: null,
  },
  evidenceCoverage: "primary-content", captureContexts: [], availability: "ready", organizationCondition: "complete",
  recognitionSummary: "Restore a base backup before replaying the write-ahead log.",
  recognitionSummaryProvenance: { contract: "tldr-v1", sourceSnapshotId: 1, isCurrent: true, evidenceCoverage: "primary-content", extractionCoverage: null },
  topicTags: [], latestAttempt: null,
};

test("cards prefer a current primary-content TL;DR over the publisher description", () => {
  expect(knowledgeItemCardDescription(item)).toEqual({ label: "TL;DR", text: item.recognitionSummary! });
  const markup = renderToStaticMarkup(<KnowledgeItemCard knowledgeItem={{ ...item, topicTags: ["Databases"] }} onOpen={() => {}} />);
  expect(markup).toContain("TL;DR");
  expect(markup).not.toContain("Databases");
  expect(markup).toContain('role="status"');
  expect(markup).toContain(item.recognitionSummary!);
  expect(markup).not.toContain(item.sourcePreview!.description!);
});

test("stale, legacy, missing-provenance, and metadata summaries do not replace source descriptions", () => {
  const provenance = item.recognitionSummaryProvenance!;
  for (const recognitionSummaryProvenance of [
    { ...provenance, isCurrent: false },
    { ...provenance, contract: null },
    null,
    { ...provenance, contract: "preview-v1", evidenceCoverage: "metadata-only" as const },
    { ...provenance, evidenceCoverage: "metadata-only" as const },
  ]) {
    const candidate = { ...item, recognitionSummaryProvenance };
    expect(knowledgeItemCardDescription(candidate)).toEqual({ label: "Source Preview", text: "Publisher introduction." });
    const markup = renderToStaticMarkup(<KnowledgeItemCard knowledgeItem={candidate} onOpen={() => {}} />);
    expect(markup).not.toContain("Source Preview: ");
    expect(markup).not.toContain(item.recognitionSummary!);
    expect(markup).not.toContain("TL;DR");
  }
});

test("current metadata-only generated descriptions remain labeled Source Preview without publisher copy", () => {
  const metadata: KnowledgeItem = { ...item, sourcePreview: null, evidenceCoverage: "metadata-only",
    recognitionSummaryProvenance: { ...item.recognitionSummaryProvenance!, contract: "preview-v1", evidenceCoverage: "metadata-only" } };
  expect(knowledgeItemCardDescription(metadata)).toEqual({ label: "Source Preview", text: metadata.recognitionSummary! });
  expect(knowledgeItemCardDescription({ ...metadata, recognitionSummaryProvenance: { ...metadata.recognitionSummaryProvenance!, isCurrent: false } })).toBeNull();
});

test("a personal note can identify an item without being presented as source-authored text", () => {
  const note: KnowledgeItem = { ...item, sourcePreview: null,
    recognitionSummaryProvenance: { ...item.recognitionSummaryProvenance!, isCurrent: false },
    captureContexts: [
      { id: 1, kind: "selected-source-text", text: "A source quotation.", summary: "Source quotation" },
      { id: 2, kind: "personal-note", text: "  Use this for the recovery exercise.  ", summary: "Generated note summary" },
    ] };
  expect(knowledgeItemCardDescription(note)).toEqual({ label: "Your note", text: "Use this for the recovery exercise." });
  const markup = renderToStaticMarkup(<KnowledgeItemCard knowledgeItem={note} onOpen={() => {}} />);
  expect(markup).not.toContain("Your note: ");
  expect(markup).not.toContain("A source quotation.");
  expect(markup).not.toContain("Generated note summary");
  expect(markup).not.toContain(item.recognitionSummary!);
});

test("cards omit unqualified generated descriptions and blank fallback text", () => {
  const blank: KnowledgeItem = { ...item, sourcePreview: { ...item.sourcePreview!, description: " " },
    captureContexts: [{ id: 1, kind: "personal-note", text: " ", summary: "Old note summary" }] };
  for (const recognitionSummaryProvenance of [null, { ...item.recognitionSummaryProvenance!, contract: null }, { ...item.recognitionSummaryProvenance!, isCurrent: false }]) {
    expect(knowledgeItemCardDescription({ ...blank, recognitionSummaryProvenance })).toBeNull();
  }
  expect(knowledgeItemCardDescription({ ...blank, recognitionSummary: " " })).toBeNull();
});

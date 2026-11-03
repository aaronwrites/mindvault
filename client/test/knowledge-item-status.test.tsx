import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { KnowledgeItemCard, itemHasLimitations } from "@/components/knowledge-item-card";
import { knowledgeItemCardStatus } from "@/lib/knowledge-item-status";
import type { KnowledgeItem } from "@/lib/types";

const ready: KnowledgeItem = {
  id: 1, createdAt: "2026-11-01T10:00:00Z", lifecycleState: "active", trashedAt: null,
  source: { id: 1, kind: "web", submittedUrl: "https://example.com/article", normalizedUrl: "https://example.com/article" },
  sourcePreview: null, evidenceCoverage: "primary-content", captureContexts: [],
  availability: "ready", organizationCondition: "complete", recognitionSummary: null,
  topicTags: [], latestAttempt: null,
};

function attempt(status: string): KnowledgeItem["latestAttempt"] {
  return { id: 1, kind: "refresh", status, createdAt: ready.createdAt, failureReason: "Private diagnostic" };
}

function pdf(pages: NonNullable<KnowledgeItem["extractionCoverage"]>["pages"], pageCount = pages.length): KnowledgeItem {
  return { ...ready, source: { ...ready.source, kind: "pdf", filename: "reference.pdf" }, extractionCoverage: { pageCount, pages } };
}

describe("card availability", () => {
  test("a routine Ready item has a quiet, visible textual label", () => {
    const status = knowledgeItemCardStatus(ready);
    expect(status.label).toBe("Ready");
    expect(status.variant).toBe("outline");
    expect(status.detail).toBeNull();
    const markup = renderToStaticMarkup(<KnowledgeItemCard knowledgeItem={ready} onOpen={() => {}} />);
    expect(markup).toContain('role="status"');
    expect(markup).toContain(">Ready</span>");
    expect(markup).not.toContain("bg-amber");
    expect(markup).toContain('aria-label="View example.com"');
  });

  test("newly captured content shows Processing while content needing intervention shows recovery", () => {
    expect(knowledgeItemCardStatus({ ...ready, availability: "processing", latestAttempt: attempt("running") }).label).toBe("Processing");
    const failed = knowledgeItemCardStatus({ ...ready, availability: "needs-attention", latestAttempt: attempt("failed") });
    expect(failed.label).toBe("Needs attention");
    expect(failed.variant).toBe("destructive");
    expect(failed.detail).toContain("Not searchable yet");
    expect(failed.detail).toContain("recovery options");
    expect(failed.detail).not.toContain("Private diagnostic");
  });

  for (const status of ["pending", "running", "failed"]) {
    test(`a ${status} refresh preserves Ready and explains search availability`, () => {
      const result = knowledgeItemCardStatus({ ...ready, latestAttempt: attempt(status), organizationCondition: "incomplete" });
      expect(result.label).toBe("Ready");
      expect(result.variant).toBe("outline");
      expect(result.detail).toContain("still searchable");
      expect(result.detail).toContain(status === "failed" ? "Open details to retry" : "Updating in the background");
      expect(result.detail).not.toContain("Private diagnostic");
      // Keep the recovery/work message readable instead of accumulating conditions.
      expect(result.detail).not.toContain("Organization incomplete");
    });
  }

  test("note indexing is a secondary condition without revoking Ready", () => {
    const indexing = knowledgeItemCardStatus({ ...ready, noteIndexing: "processing" });
    expect(indexing.label).toBe("Ready");
    expect(indexing.detail).toContain("Updating note search");
    const incomplete = knowledgeItemCardStatus({ ...ready, noteIndexing: "incomplete", latestAttempt: attempt("failed") });
    expect(incomplete.label).toBe("Ready");
    expect(incomplete.detail).toContain("Note search incomplete");
    expect(incomplete.detail).toContain("Open details to retry");
  });

  test("unsupported retained originals do not look like failed processing", () => {
    const source = { ...ready.source, kind: "image", filename: "reference.png" };
    const unsupported = knowledgeItemCardStatus({ ...ready, source, availability: "unsupported" });
    expect(unsupported.label).toBe("Unsupported");
    expect(unsupported.variant).toBe("outline");
    expect(unsupported.detail).toContain("Original file retained");
    expect(unsupported.detail).not.toMatch(/failed|retry|attention/i);
    const notesReady = knowledgeItemCardStatus({ ...ready, source, latestAttempt: attempt("unsupported") });
    expect(notesReady.label).toBe("Ready");
    expect(notesReady.detail).toContain("Saved text is searchable");
    expect(notesReady.detail).toContain("original content can’t be read");
  });

  test("unprocessed PDFs distinguish a retained file from a saved link", () => {
    const retained = { ...pdf([]), availability: "unsupported" as const };
    expect(knowledgeItemCardStatus(retained).detail).toContain("Open details to process its text");
    const link = { ...ready, availability: "unsupported" as const, source: { ...ready.source, kind: "pdf" } };
    expect(knowledgeItemCardStatus(link).detail).toContain("Upload the PDF");
  });

  test("metadata and incomplete organization are distinct from availability failures", () => {
    const metadata = knowledgeItemCardStatus({ ...ready, evidenceCoverage: "metadata-only" });
    expect(metadata.label).toBe("Ready");
    expect(metadata.detail).toContain("Website description only");
    expect(metadata.detail).not.toMatch(/retry|failed|attention/i);
    const organization = knowledgeItemCardStatus({ ...ready, organizationCondition: "incomplete" });
    expect(organization.label).toBe("Ready");
    expect(organization.detail).toContain("Organization incomplete");
    expect(organization.detail).toContain("still searchable");
  });

  test("Trash never claims that retained Ready content is included in search", () => {
    const trashed = knowledgeItemCardStatus({ ...ready, lifecycleState: "trashed" });
    expect(trashed.label).toBe("In Trash");
    expect(trashed.detail).toContain("Excluded from search");
    const deleting = renderToStaticMarkup(<KnowledgeItemCard knowledgeItem={{ ...ready, lifecycleState: "pending-permanent-deletion" }} onOpen={() => {}} />);
    expect(deleting).toContain("Deleting");
    expect(deleting).not.toContain(">Ready</span>");
  });
});

describe("PDF evidence scope", () => {
  test("complete textual extraction is informational and does not imply visual understanding", () => {
    const item = pdf([{ pageNumber: 1, outcome: "extracted", reason: null }, { pageNumber: 2, outcome: "blank", reason: null }]);
    const status = knowledgeItemCardStatus(item);
    expect(status.label).toBe("Ready");
    expect(status.variant).toBe("outline");
    expect(status.detail).toContain("PDF text available");
    expect(status.detail).toContain("diagrams and charts aren’t interpreted");
    expect(status.detail).not.toMatch(/partial|failed|attention/i);
    // Details still expand to disclose provenance and visual limits.
    expect(itemHasLimitations(item)).toBe(true);
  });

  for (const outcome of ["needs-ocr", "failed", "unreadable", "unprocessed"] as const) {
    test(`${outcome} pages disclose partial evidence without changing Ready`, () => {
      const status = knowledgeItemCardStatus(pdf([
        { pageNumber: 1, outcome: "extracted", reason: null },
        { pageNumber: 2, outcome, reason: "Bounded extraction gap" },
        { pageNumber: 3, outcome: "blank", reason: null },
      ]));
      expect(status.label).toBe("Ready");
      expect(status.variant).toBe("outline");
      expect(status.detail).toContain("Partial PDF text: 1 of 3 pages extracted");
      expect(status.detail).toContain("Open details for coverage");
    });
  }

  test("retained text with raster gaps is still partial even if every page has text", () => {
    const status = knowledgeItemCardStatus(pdf([{ pageNumber: 1, outcome: "extracted", reason: "Native text retained; raster text coverage incomplete" }]));
    expect(status.label).toBe("Ready");
    expect(status.detail).toContain("Partial PDF text");
  });

  test("missing coverage entries do not imply complete extraction", () => {
    const status = knowledgeItemCardStatus(pdf([{ pageNumber: 1, outcome: "extracted", reason: null }], 3));
    expect(status.detail).toContain("Partial PDF text: 1 of 3 pages extracted");
  });

  test("Ready from other saved evidence does not imply extracted PDF text", () => {
    const status = knowledgeItemCardStatus(pdf([{ pageNumber: 1, outcome: "unreadable", reason: "No trustworthy text" }]));
    expect(status.label).toBe("Ready");
    expect(status.detail).toContain("No PDF text extracted");
    expect(status.detail).not.toContain("notes");
  });
});

import type { KnowledgeItem } from "@/lib/types";

export function PdfExtractionCoverage({ coverage }: { coverage: KnowledgeItem["extractionCoverage"] }) {
  if (!coverage) return null;
  const gaps = coverage.pages.filter(page => !["extracted", "blank"].includes(page.outcome));
  return (
    <p className="text-sm text-muted-foreground" role="status">
      Text extracted from {coverage.pages.filter(page => page.outcome === "extracted").length} of {coverage.pageCount} PDF pages.
      {gaps.length > 0 && ` Incomplete extraction: ${gaps.map(page => `page ${page.pageNumber} (${page.reason ?? page.outcome})`).join("; ")}.`}
      {" "}Diagrams, charts, and visual relationships have not been interpreted.
    </p>
  );
}

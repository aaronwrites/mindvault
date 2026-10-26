import type { PdfEvidence } from "../../db/schema";

export function pdfExtractionDisclosure(pdf: PdfEvidence | null | undefined): string {
    if (!pdf) return "";
    const obtained = pdf.pages.filter(page => page.outcome === "extracted").map(page => page.pageNumber);
    const gaps = pdf.pages.filter(page => page.reason || !["extracted", "blank"].includes(page.outcome)).map(page => `${page.pageNumber} (${page.reason ?? page.outcome})`);
    return `PDF textual Extraction Coverage: ${pdf.pageCount} physical pages; text obtained from pages ${obtained.join(", ")}. ${gaps.length ? `Incomplete extraction; unread pages: ${gaps.join(", ")}. Acknowledge incomplete coverage.` : ""} Use only obtained text. Diagrams, charts, and visual relationships have not been interpreted; extracted labels cannot establish them.`;
}

export type PdfExtractionCoverage = Omit<PdfEvidence, "pages"> & { pages: Array<Omit<PdfEvidence["pages"][number], "text">> };

export function pdfExtractionCoverage(pdf: PdfEvidence): PdfExtractionCoverage {
    return { pageCount: pdf.pageCount, pages: pdf.pages.map(({ text: _text, ...page }) => page) };
}

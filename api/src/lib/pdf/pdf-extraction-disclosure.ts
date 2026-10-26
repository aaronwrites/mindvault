import type { PdfEvidence } from "../../db/schema";

export function pdfExtractionDisclosure(pdf: PdfEvidence | null | undefined): string {
    if (!pdf) return "";
    const obtained = pdf.pages.filter(page => page.outcome === "extracted").map(page => page.pageNumber);
    const gaps = pdf.pages.filter(page => !["extracted", "blank"].includes(page.outcome)).map(page => `${page.pageNumber} (${page.reason ?? page.outcome})`);
    return `PDF textual Extraction Coverage: ${pdf.pageCount} physical pages; text obtained from pages ${obtained.join(", ")}. ${gaps.length ? `Incomplete extraction; unread pages: ${gaps.join(", ")}. Acknowledge incomplete coverage.` : ""} Use only obtained text. Diagrams, charts, and visual relationships have not been interpreted; extracted labels cannot establish them.`;
}

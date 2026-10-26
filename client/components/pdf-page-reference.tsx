import { Button } from "@/components/ui/button";
import { API_URL } from "@/lib/api";

export function PdfPageReference({ pageNumber, pageLabel, openOriginalFile }: {
  pageNumber?: number | null;
  pageLabel?: string | null;
  openOriginalFile?: string;
}) {
  if (!pageNumber) return null;
  return (
    <div className="space-y-1 text-sm">
      <p>Page {pageNumber}{pageLabel ? ` (printed label: ${pageLabel})` : ""}</p>
      {openOriginalFile && <Button variant="outline" size="sm" nativeButton={false}
        render={<a href={`${API_URL}${openOriginalFile}`} target="_blank" rel="noopener noreferrer" />}>
        Open PDF at page {pageNumber}
      </Button>}
      <p className="text-xs text-muted-foreground">If your viewer does not jump to this page, use physical page {pageNumber} and the excerpt above to locate the evidence.</p>
    </div>
  );
}

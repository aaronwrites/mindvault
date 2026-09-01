import { FileText, Globe2 } from "lucide-react";
import type { KnowledgeItem } from "@/lib/types";

type SourcePreview = KnowledgeItem["sourcePreview"];

export function SourcePreviewMedia({ preview }: { preview: SourcePreview }) {
  if (preview?.previewImageUrl) {
    // Retained API media is already bounded and validated; Next's optimizer cannot fetch this private API endpoint.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={preview.previewImageUrl} alt={preview.previewImageAlt ?? ""} className="aspect-[16/7] w-full object-cover" />;
  }

  return (
    <div role="img" aria-label="Webpage preview placeholder" className="flex aspect-[16/7] items-center justify-center bg-muted text-muted-foreground">
      <Globe2 aria-hidden="true" className="size-10" />
    </div>
  );
}

export function OriginalFilePlaceholder({ sourceKind }: { sourceKind: string }) {
  const label = `${sourceKindLabel(sourceKind)} file placeholder`;
  return <div role="img" aria-label={label} className="flex aspect-[16/7] items-center justify-center bg-muted text-muted-foreground"><FileText aria-hidden="true" className="size-10" /></div>;
}

export function SourcePreviewFacts({ preview, submittedUrl }: { preview: SourcePreview; submittedUrl: string }) {
  const hostname = readableHostname(submittedUrl);
  return (
    <>
      <p className="text-sm font-medium text-muted-foreground">{displayContentType(preview?.contentType ?? "webpage")}</p>
      <p className="break-all text-sm text-muted-foreground">{preview?.websiteName ?? hostname}</p>
      {preview?.description && <p className="text-sm text-muted-foreground">{preview.description}</p>}
      {(preview?.author || preview?.publishedAt) && (
        <p className="text-sm text-muted-foreground">
          {[preview.author, preview.publishedAt ? formatPublicationDate(preview.publishedAt) : null].filter(Boolean).join(" · ")}
        </p>
      )}
    </>
  );
}

export function sourcePreviewTitle(preview: SourcePreview, submittedUrl: string) {
  return preview?.title ?? readableHostname(submittedUrl);
}

export function originalFileTitle(filename: string | null | undefined, sourceKind: string) {
  const safe = filename?.split(/[\\/]/).at(-1)?.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return safe || `${sourceKindLabel(sourceKind)} file`;
}

export function sourceKindLabel(value: string) {
  if (value === "pdf") return "PDF";
  return displayContentType(value);
}

export function formatByteSize(bytes: number | undefined) {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return null;
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

function readableHostname(address: string) {
  try {
    return new URL(address).hostname;
  } catch {
    return address;
  }
}

function displayContentType(value: string) {
  return value.replaceAll(/[-_]/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function formatPublicationDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  }).format(date);
}

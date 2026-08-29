import { Globe2 } from "lucide-react";
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

import { Badge } from "@/components/ui/badge";
import type { knowledgeItemCardStatus } from "@/lib/knowledge-item-status";

type Status = ReturnType<typeof knowledgeItemCardStatus>["label"] | "Deleting" | "Deletion failed";
const statusColors: Record<Status, string> = {
  Ready: "text-emerald-800 dark:text-emerald-300",
  Processing: "text-sky-800 dark:text-sky-300",
  Unsupported: "text-amber-800 dark:text-amber-300",
  "Needs attention": "text-rose-800 dark:text-rose-300",
  "In Trash": "text-muted-foreground",
  Deleting: "text-sky-800 dark:text-sky-300",
  "Deletion failed": "text-rose-800 dark:text-rose-300",
};

export function ItemStatusBadge({ status }: { status: Status; expanded?: boolean }) {
  return <Badge render={<span />} variant="outline" aria-label={`Status: ${status}`} data-status={status} className={`item-status ${statusColors[status]}`}>
    <span aria-hidden="true" className="item-status-dot" /><span>{status}</span>
  </Badge>;
}

export function CardHoverSummary({ status, summary, label = "TL;DR", processing = false, organizationIncomplete = false }: {
  status: Status; summary: string | null; label?: string; processing?: boolean; organizationIncomplete?: boolean;
}) {
  return <>
    {summary && <div className="card-description"><p className="description-label">{label}</p><p className="line-clamp-4 break-words">{summary}</p></div>}
    <div role="status" aria-label={status === "Processing" ? "Processing saved content" : undefined} className="card-availability">
      <ItemStatusBadge status={status} />
      {organizationIncomplete && <span className="text-xs text-muted-foreground">Organization incomplete</span>}
      {processing && status !== "Processing" && <span className="text-xs text-muted-foreground">Updating…</span>}
    </div>
  </>;
}

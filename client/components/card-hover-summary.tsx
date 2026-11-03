import { Badge } from "@/components/ui/badge";
import type { knowledgeItemCardStatus } from "@/lib/knowledge-item-status";

type Status = ReturnType<typeof knowledgeItemCardStatus>["label"] | "Deleting" | "Deletion failed";
const statusColors: Record<Status, string> = {
  Ready: "border-emerald-300 bg-emerald-100 text-emerald-950",
  Processing: "border-sky-300 bg-sky-100 text-sky-950",
  Unsupported: "border-amber-300 bg-amber-100 text-amber-950",
  "Needs attention": "border-rose-300 bg-rose-100 text-rose-950",
  "In Trash": "border-slate-300 bg-slate-200 text-slate-950",
  Deleting: "border-sky-300 bg-sky-100 text-sky-950",
  "Deletion failed": "border-rose-300 bg-rose-100 text-rose-950",
};

export function CardHoverSummary({ status, summary }: { status: Status; summary: string | null }) {
  return <>
    <div role="status" aria-label={status === "Processing" ? "Processing saved content" : undefined}>
      <Badge variant="outline" className={statusColors[status]}>{status}</Badge>
    </div>
    {summary && <p className="line-clamp-2 break-words text-sm text-white"><span className="font-medium">TL;DR: </span>{summary}</p>}
  </>;
}

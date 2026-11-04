import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function ProcessingIndicator({ label, compact = false, className }: {
  label: string;
  kind?: "capture" | "processing" | "synthesis" | "loading";
  compact?: boolean;
  className?: string;
}) {
  return <div role="status" className={cn("processing-indicator", compact && "processing-indicator-compact", className)}>
    <LoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
    <span>{label}</span>
  </div>;
}

export function LibrarySkeleton({ label }: { label: string }) {
  return <div aria-busy="true" className="space-y-5">
    <ProcessingIndicator kind="loading" label={label} />
    <div aria-hidden="true" className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {[0, 1, 2, 3].map(value => <div key={value} className="space-y-4"><div className={`skeleton-block rounded-xl ${value % 2 ? "h-48" : "h-64"}`} /><div className="skeleton-block h-4 w-4/5 rounded" /><div className="skeleton-block h-3 w-2/5 rounded" /></div>)}
    </div>
  </div>;
}

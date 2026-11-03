import type { ReactNode } from "react";
import { ItemQuickActions } from "@/components/item-quick-actions";
import { OriginalFilePlaceholder, SourcePreviewMedia } from "@/components/source-preview";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { KnowledgeItem, RecallKnowledgeItem } from "@/lib/types";

export function ImageTitleCard({ item, title, onOpen, onTrash, children }: {
  item: KnowledgeItem | RecallKnowledgeItem;
  title: string;
  onOpen?: (id: number) => void;
  onTrash?: (id: number, title: string) => void;
  children?: ReactNode;
}) {
  return <Card className="group/card relative mb-6 gap-2 overflow-visible rounded-none bg-transparent py-0 shadow-none ring-0 dark:ring-0" onClick={event => {
    if (event.target instanceof Element && !event.target.closest('a, button, input, textarea, select, [role="button"], [role="menuitem"]')) onOpen?.(item.id);
  }}>
    {onOpen && <Button variant="ghost" className="absolute inset-0 z-10 size-full cursor-pointer rounded-xl hover:bg-transparent active:translate-y-0 dark:hover:bg-transparent" aria-label={`View ${title}`} onClick={() => onOpen(item.id)} />}
    <div className="relative overflow-hidden rounded-xl">
      <div className="bg-muted [&>img]:aspect-[4/3] [&>img]:object-contain [&>div]:aspect-[4/3]">
        {item.source.filename !== undefined && !item.sourcePreview?.previewImageUrl
          ? <OriginalFilePlaceholder sourceKind={item.source.kind} />
          : <SourcePreviewMedia preview={item.sourcePreview} />}
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-black/65 opacity-0 transition-opacity duration-200 group-hover/card:opacity-100 group-focus-within/card:opacity-100 group-has-[[aria-expanded=true]]/card:opacity-100 motion-reduce:transition-none" />
      {children && <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-end p-4 pt-16 text-white opacity-0 transition-opacity duration-200 group-hover/card:opacity-100 group-focus-within/card:opacity-100 group-has-[[aria-expanded=true]]/card:opacity-100 motion-reduce:transition-none">
        <div className="pointer-events-auto min-h-0 space-y-3 overflow-hidden text-sm [--muted-foreground:var(--color-white)] [&_a]:text-white [&_button]:border-white/40 [&_button]:bg-black/50 [&_button]:text-white [&_button:hover]:bg-black/70">
          {children}
        </div>
      </div>}
    </div>
    {onTrash && <div className="pointer-events-auto absolute top-3 right-3 z-20"><ItemQuickActions item={item} title={title} onTrash={onTrash} /></div>}
    <h3 className="break-words px-0.5 text-base leading-snug font-medium">{title}</h3>
  </Card>;
}

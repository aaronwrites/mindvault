import { ExternalLink, MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { API_URL } from "@/lib/api";
import type { KnowledgeItem, RecallKnowledgeItem } from "@/lib/types";

export function ItemQuickActions({ item, title, onTrash }: {
  item: KnowledgeItem | RecallKnowledgeItem;
  title: string;
  onTrash: (id: number, title: string) => void;
}) {
  const href = item.source.filename !== undefined
    ? item.source.originalFileActions?.open && `${API_URL}${item.source.originalFileActions.open}`
    : ("excerpts" in item ? item.excerpts[0]?.sourceSnapshot?.originalUrl : undefined) ?? item.source.submittedUrl;
  const buttonStyle = "size-11 border-white/40 bg-black/60 text-white hover:bg-black/80 hover:text-white dark:bg-black/60 dark:hover:bg-black/80 sm:size-9";
  return <div className="relative z-20 flex justify-end gap-2 opacity-0 transition-opacity duration-200 group-hover/card:opacity-100 group-focus-within/card:opacity-100 group-has-[[aria-expanded=true]]/card:opacity-100 motion-reduce:transition-none max-sm:opacity-100 [@media(hover:none)]:opacity-100" onClick={event => event.stopPropagation()}>
    <div className="hidden gap-2 sm:flex [@media(hover:none)]:hidden">
      {href && <Button variant="outline" size="icon" className={buttonStyle} aria-label={"excerpts" in item ? "Open original" : `Open original of ${title}`} render={<a href={href} target="_blank" rel="noopener noreferrer" />} nativeButton={false}><ExternalLink /></Button>}
      <Button variant="outline" size="icon" className={buttonStyle} aria-label={`Move ${title} to Trash`} onClick={() => onTrash(item.id, title)}><Trash2 /></Button>
    </div>
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="icon" className={buttonStyle} aria-label={`Actions for ${title}`} />}><MoreHorizontal /></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {href && <DropdownMenuItem render={<a href={href} target="_blank" rel="noopener noreferrer" />}>Open original</DropdownMenuItem>}
        <DropdownMenuItem variant="destructive" onClick={() => onTrash(item.id, title)}>Move to Trash</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}

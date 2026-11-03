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
    : item.source.submittedUrl;
  return <div className="relative z-20 flex justify-end gap-1" onClick={event => event.stopPropagation()}>
    <div className="flex gap-1 opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100 [@media(hover:none)]:hidden">
      {href && <Button variant="outline" size="icon" aria-label={`Open original of ${title}`} render={<a href={href} target="_blank" rel="noopener noreferrer" />} nativeButton={false}><ExternalLink /></Button>}
      <Button variant="outline" size="icon" aria-label={`Move ${title} to Trash`} onClick={() => onTrash(item.id, title)}><Trash2 /></Button>
    </div>
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label={`Actions for ${title}`} />}><MoreHorizontal /></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {href && <DropdownMenuItem render={<a href={href} target="_blank" rel="noopener noreferrer" />}>Open original</DropdownMenuItem>}
        <DropdownMenuItem variant="destructive" onClick={() => onTrash(item.id, title)}>Move to Trash</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}

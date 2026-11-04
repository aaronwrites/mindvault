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
  const buttonStyle = "size-11 border-transparent bg-card text-foreground hover:bg-muted hover:text-foreground";
  return <div className="relative z-20 flex justify-end gap-2" onClick={event => event.stopPropagation()}>
    <div className="card-secondary-actions hidden gap-2">
      {href && <Button variant="outline" size="icon" className={buttonStyle} aria-label={"excerpts" in item ? "Open original" : `Open original of ${title}`} render={<a href={href} target="_blank" rel="noopener noreferrer" />} nativeButton={false}><ExternalLink /></Button>}
      <Button variant="outline" size="icon" className={buttonStyle} aria-label={`Move ${title} to Trash`} onClick={() => onTrash(item.id, title)}><Trash2 /></Button>
    </div>
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="icon" className={buttonStyle} aria-label={`Actions for ${title}`} />}><MoreHorizontal /></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {href && <DropdownMenuItem className="min-h-11" render={<a href={href} target="_blank" rel="noopener noreferrer" />}>Open original</DropdownMenuItem>}
        <DropdownMenuItem className="min-h-11" variant="destructive" onClick={() => onTrash(item.id, title)}>Move to Trash</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}

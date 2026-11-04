"use client";

import { useQuery } from "@tanstack/react-query";
import type { RefObject } from "react";
import { KnowledgeItemDetails, type KnowledgeItemActions } from "@/components/knowledge-item-details";
import { isItemProcessing, knowledgeItemTitle } from "@/components/knowledge-item-card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getKnowledgeItem, knowledgeItemKeys } from "@/lib/api";
import type { KnowledgeItem } from "@/lib/types";
import { ProcessingIndicator } from "@/components/processing-indicator";
import { ItemTitleEditor } from "@/components/item-title-editor";

export function KnowledgeItemDialog({ itemId, trashedItem, onClose, returnFocus, actions, actionError }: {
  itemId: number | null;
  trashedItem?: KnowledgeItem;
  onClose: () => void;
  returnFocus: RefObject<HTMLElement | null>;
  actions: KnowledgeItemActions;
  actionError?: string;
}) {
  const query = useQuery({
    queryKey: knowledgeItemKeys.detail(itemId),
    queryFn: () => getKnowledgeItem(itemId!),
    enabled: itemId !== null && !trashedItem,
    refetchInterval: query => query.state.data && isItemProcessing(query.state.data) ? 2_000 : false,
  });
  const item = trashedItem ?? query.data;
  return <Dialog open={itemId !== null} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent finalFocus={returnFocus} className="item-dialog gap-0 p-0 max-md:inset-0 max-md:translate-x-0 max-md:translate-y-0 md:max-w-[1120px]">
      <div className="item-dialog-header">
        <DialogTitle className="detail-title break-words">{item ? knowledgeItemTitle(item) : "Saved details"}</DialogTitle>
        {item?.lifecycleState === "active" && <ItemTitleEditor key={item.id} item={item} />}
      </div>
      <DialogDescription className="sr-only">Preview, tags, original content, and save details.</DialogDescription>
      {query.isPending && !trashedItem && <div className="space-y-5 p-6"><ProcessingIndicator kind="loading" label="Loading details…" /><div aria-hidden="true" className="skeleton-block h-40 rounded-xl" /><div aria-hidden="true" className="skeleton-block h-24 rounded-xl" /></div>}
      {query.error && !trashedItem && <div role="alert" className="space-y-3 p-6"><p>Couldn’t load details. Your save is still safe. Please try again.</p><Button variant="outline" onClick={() => void query.refetch()}>Try again</Button></div>}
      {actionError && <p role="alert" className="p-6 text-destructive">{actionError}</p>}
      {item && <KnowledgeItemDetails key={item.id} knowledgeItem={item} {...actions} />}
    </DialogContent>
  </Dialog>;
}

"use client";

import { useQuery } from "@tanstack/react-query";
import type { RefObject } from "react";
import { KnowledgeItemDetails, type KnowledgeItemActions } from "@/components/knowledge-item-details";
import { isItemProcessing, knowledgeItemTitle } from "@/components/knowledge-item-card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getKnowledgeItem, knowledgeItemKeys } from "@/lib/api";
import type { KnowledgeItem } from "@/lib/types";

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
    <DialogContent finalFocus={returnFocus} className="inset-0 max-h-dvh max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-none pt-14 motion-reduce:animate-none sm:inset-auto sm:top-1/2 sm:left-1/2 sm:max-h-[90dvh] sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl">
      <DialogTitle className="break-words text-2xl">{item ? knowledgeItemTitle(item) : "Saved details"}</DialogTitle>
      <DialogDescription className="sr-only">Preview, tags, original content, and save details.</DialogDescription>
      {query.isPending && !trashedItem && <p role="status">Loading details…</p>}
      {query.error && !trashedItem && <div role="alert"><p>Couldn’t load details. Your save is still safe. Please try again.</p><Button variant="outline" onClick={() => void query.refetch()}>Try again</Button></div>}
      {actionError && <p role="alert">{actionError}</p>}
      {item && <KnowledgeItemDetails key={item.id} knowledgeItem={item} {...actions} />}
    </DialogContent>
  </Dialog>;
}

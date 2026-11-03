"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { knowledgeItemKeys, recallKeys, permanentlyDeleteKnowledgeItem, restoreKnowledgeItem, trashKnowledgeItem } from "@/lib/api";
import type { KnowledgeItem, RecallKnowledgeItem } from "@/lib/types";

type Operation = "trash" | "restore" | "delete";
type Notice = { id: number; title: string; operation: Operation; pending: boolean; failed: boolean };

export function useItemLifecycle(onRemoved: (id: number) => void) {
  const client = useQueryClient();
  const [notices, setNotices] = useState<Notice[]>([]);
  const inFlight = useRef(new Set<number>());
  // Keep late search responses from reintroducing removed knowledge.
  const [removedIds, setRemovedIds] = useState<Set<number>>(new Set());
  function markActive(id: number) {
    setRemovedIds(ids => { const next = new Set(ids); next.delete(id); return next; });
    setNotices(current => current.filter(notice => notice.id !== id));
  }
  async function cancelSnapshots(id: number) {
    await Promise.all([
      client.cancelQueries({ queryKey: knowledgeItemKeys.all, exact: true }),
      client.cancelQueries({ queryKey: knowledgeItemKeys.detail(id), exact: true }),
      client.cancelQueries({ queryKey: knowledgeItemKeys.trash, exact: true }),
      client.cancelQueries({ queryKey: recallKeys.all }),
    ]);
  }
  async function run(operation: Operation, id: number, title: string) {
    if (inFlight.current.has(id)) return;
    inFlight.current.add(id);
    const notice = { id, title, operation, pending: true, failed: false };
    setNotices(current => [...current.filter(entry => entry.id !== id), notice]);
    try {
      if (operation === "trash") {
        await trashKnowledgeItem(id);
        await cancelSnapshots(id);
        setRemovedIds(ids => new Set([...ids, id]));
        client.setQueryData<KnowledgeItem[]>(knowledgeItemKeys.all, current => current?.filter(item => item.id !== id));
        client.setQueriesData<RecallKnowledgeItem[]>({ queryKey: recallKeys.all }, current => current?.filter(item => item.id !== id));
        client.removeQueries({ queryKey: knowledgeItemKeys.detail(id), exact: true });
        onRemoved(id);
      } else if (operation === "restore") {
        const { knowledgeItem } = await restoreKnowledgeItem(id);
        await cancelSnapshots(id);
        client.setQueryData(knowledgeItemKeys.detail(id), knowledgeItem);
        client.setQueryData<KnowledgeItem[]>(knowledgeItemKeys.all, current => [knowledgeItem, ...(current ?? []).filter(item => item.id !== id)]);
        client.setQueryData<KnowledgeItem[]>(knowledgeItemKeys.trash, current => current?.filter(item => item.id !== id));
        markActive(id);
        onRemoved(id);
      } else {
        const result = await permanentlyDeleteKnowledgeItem(id);
        await cancelSnapshots(id);
        client.setQueryData<KnowledgeItem[]>(knowledgeItemKeys.trash, current => result?.deletionPending
          ? current?.map(item => item.id === id ? { ...item, lifecycleState: "pending-permanent-deletion", deletion: { status: "pending", failureReason: null } } : item)
          : current?.filter(item => item.id !== id));
        client.removeQueries({ queryKey: knowledgeItemKeys.detail(id), exact: true });
        onRemoved(id);
      }
      setNotices(current => operation === "restore" || operation === "delete" ? current.filter(entry => entry.id !== id) : current.map(entry => entry.id === id ? { ...notice, pending: false } : entry));
      void client.invalidateQueries({ queryKey: knowledgeItemKeys.all, exact: true });
      void client.invalidateQueries({ queryKey: knowledgeItemKeys.trash, exact: true });
      void client.invalidateQueries({ queryKey: recallKeys.all });
    } catch {
      setNotices(current => current.map(entry => entry.id === id ? { ...notice, pending: false, failed: true } : entry));
    } finally {
      inFlight.current.delete(id);
    }
  }
  return { notices, removedIds, markActive, run,
    isPending: (id: number | null) => notices.some(notice => notice.id === id && notice.pending),
  };
}

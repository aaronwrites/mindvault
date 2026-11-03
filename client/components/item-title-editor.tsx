"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { knowledgeItemTitle } from "@/components/knowledge-item-card";
import { knowledgeItemKeys, recallKeys, updateKnowledgeItemTitle } from "@/lib/api";
import type { KnowledgeItem, RecallKnowledgeItem } from "@/lib/types";

export function ItemTitleEditor({ item }: { item: KnowledgeItem }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const mutation = useMutation({
    mutationFn: (title: string | null) => updateKnowledgeItemTitle(item.id, title),
    onSuccess: async updated => {
      // A read already in flight must not restore an older title over this edit.
      await Promise.all([
        client.cancelQueries({ queryKey: knowledgeItemKeys.all }),
        client.cancelQueries({ queryKey: recallKeys.all }),
      ]);
      client.setQueryData(knowledgeItemKeys.detail(updated.id), updated);
      client.setQueryData<KnowledgeItem[]>(knowledgeItemKeys.all, items => items?.map(value => value.id === updated.id ? updated : value));
      client.setQueriesData<RecallKnowledgeItem[]>({ queryKey: recallKeys.all }, items => items?.map(value => value.id === updated.id ? { ...value, title: knowledgeItemTitle(updated) } : value));
      setEditing(false);
      setError("");
      setNotice(updated.customTitle ? "Title saved." : "Source title restored.");
    },
    onError: () => setError("Couldn’t save the title. Please try again."),
  });
  function save(value: string | null) {
    setNotice("");
    if (value !== null && (!value.trim() || value.trim().length > 500 || /[\u0000-\u001F\u007F]/.test(value))) {
      setError("Use a title of 1–500 characters without line breaks or control characters.");
      return;
    }
    setError("");
    mutation.mutate(value === null ? null : value.trim());
  }
  return <section aria-label="Your title" className="space-y-2">
    {editing ? <form noValidate onSubmit={event => { event.preventDefault(); save(draft); }} className="space-y-2">
      <Label htmlFor={`item-title-${item.id}`}>Title</Label>
      <Input id={`item-title-${item.id}`} autoFocus value={draft} maxLength={500} disabled={mutation.isPending} aria-invalid={Boolean(error)} aria-describedby={error ? `title-error-${item.id}` : undefined} onChange={event => setDraft(event.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Saving…" : "Save title"}</Button>
        <Button type="button" variant="ghost" disabled={mutation.isPending} onClick={() => { setEditing(false); setError(""); }}>Cancel</Button>
      </div>
    </form> : <Button variant="ghost" disabled={mutation.isPending} onClick={() => { setDraft(knowledgeItemTitle(item)); setEditing(true); setError(""); setNotice(""); }}>Edit title</Button>}
    {item.customTitle && <Button variant="ghost" disabled={mutation.isPending} onClick={() => save(null)}>Reset to source title</Button>}
    {error && <p id={`title-error-${item.id}`} role="alert" className="text-sm">{error}</p>}
    {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
  </section>;
}

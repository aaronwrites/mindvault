"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { knowledgeItemKeys, recallKeys, updateKnowledgeItemTags } from "@/lib/api";
import type { KnowledgeItem, RecallKnowledgeItem } from "@/lib/types";

export function ItemTagsEditor({ item }: { item: KnowledgeItem }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const mutation = useMutation({
    mutationFn: (changes: { add: string[]; remove: string[] }) => updateKnowledgeItemTags(item.id, changes),
    onSuccess: async updated => {
      await client.cancelQueries({ queryKey: knowledgeItemKeys.all });
      client.setQueryData(knowledgeItemKeys.detail(updated.id), updated);
      client.setQueryData<KnowledgeItem[]>(knowledgeItemKeys.all, items => items?.map(value => value.id === updated.id ? updated : value));
      client.setQueriesData<RecallKnowledgeItem[]>({ queryKey: recallKeys.all }, items => items?.map(value => value.id === updated.id ? { ...value, topicTags: updated.topicTags } : value));
      setDraft(null);
      setReplacing(null);
      setError("");
      setNotice("Tags saved.");
    },
    onError: () => setError("Couldn’t save the tags. Please try again."),
  });
  function save(add: string[], remove: string[]) {
    setNotice("");
    if (add.some(value => !value.normalize("NFKC").trim() || value.normalize("NFKC").trim().length > 100 || /[\u0000-\u001F\u007F]/.test(value))) {
      setError("Use tag names of 1–100 characters without line breaks or control characters.");
      return;
    }
    setError("");
    mutation.mutate({ add, remove });
  }
  const editable = item.lifecycleState === "active";
  return <section aria-label="Tags" className="space-y-2">
    <h3 className="font-medium">Tags</h3>
    <ul className="flex flex-wrap gap-2">{item.topicTags.map(tag => <li key={tag} className="flex flex-wrap items-center gap-1">
      <Badge variant="secondary">{tag}</Badge>
      {editing && <>
        <Button variant="ghost" size="sm" disabled={mutation.isPending} aria-label={`Replace ${tag}`} onClick={() => { setDraft(tag); setReplacing(tag); setError(""); setNotice(""); }}>Replace</Button>
        <Button variant="ghost" size="sm" disabled={mutation.isPending} aria-label={`Remove ${tag}`} onClick={() => save([], [tag])}>Remove</Button>
      </>}
    </li>)}</ul>
    {editable && !editing && <Button variant="ghost" onClick={() => setEditing(true)}>Edit tags</Button>}
    {editing && <>
      {draft === null ? <Button variant="outline" disabled={mutation.isPending} onClick={() => { setDraft(""); setReplacing(null); setError(""); setNotice(""); }}>Add tag</Button> : <form noValidate className="space-y-2" onSubmit={event => { event.preventDefault(); save([draft], replacing ? [replacing] : []); }}>
        <Label htmlFor={`tag-name-${item.id}`}>Tag name</Label>
        <Input id={`tag-name-${item.id}`} autoFocus value={draft} maxLength={100} disabled={mutation.isPending} aria-invalid={Boolean(error)} aria-describedby={error ? `tag-error-${item.id}` : undefined} onChange={event => setDraft(event.target.value)} />
        <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Saving…" : "Save tag"}</Button>
        <Button type="button" variant="ghost" disabled={mutation.isPending} onClick={() => { setDraft(null); setError(""); }}>Cancel</Button>
      </form>}
      <Button variant="ghost" disabled={mutation.isPending} onClick={() => { setEditing(false); setDraft(null); setError(""); }}>Done</Button>
    </>}
    {error && <p id={`tag-error-${item.id}`} role="alert" className="text-sm">{error}</p>}
    {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
  </section>;
}

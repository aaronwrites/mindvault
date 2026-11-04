"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { OutlinedPanel } from "@/components/outlined-panel";
import { knowledgeItemKeys, recallKeys, maintainPersonalNote, type PersonalNoteChange } from "@/lib/api";
import type { KnowledgeItem, RecallKnowledgeItem } from "@/lib/types";

export function ItemNotesEditor({ item }: { item: KnowledgeItem }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState<{ id?: number; text: string } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const mutation = useMutation({
    mutationFn: (change: PersonalNoteChange) => maintainPersonalNote(item.id, change),
    onSuccess: async (updated, change) => {
      await client.cancelQueries({ queryKey: knowledgeItemKeys.all });
      client.setQueryData(knowledgeItemKeys.detail(updated.id), updated);
      client.setQueryData<KnowledgeItem[]>(knowledgeItemKeys.all, items => items?.map(value => value.id === updated.id ? updated : value));
      // Cached matching excerpts must not keep showing obsolete personal evidence.
      client.setQueriesData<RecallKnowledgeItem[]>({ queryKey: recallKeys.all }, items => items?.filter(value => value.id !== updated.id));
      setEditing(null);
      setError("");
      setNotice(change.action === "remove" ? "Note removed." : change.action === "retry" ? "Updating note search…" : "Note saved.");
      await client.invalidateQueries({ queryKey: knowledgeItemKeys.all });
    },
    onError: () => setError("Couldn’t save the note change. Please try again."),
  });
  function save(change: PersonalNoteChange) {
    setNotice("");
    if (change.action !== "remove" && change.action !== "retry" && (!change.text.trim() || change.text.length > 50000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(change.text))) {
      setError("Use a note of 1–50,000 characters without control characters.");
      return;
    }
    setError("");
    mutation.mutate(change);
  }
  const editable = item.lifecycleState === "active";
  const notes = item.captureContexts.filter(context => context.kind === "personal-note");
  const selections = item.captureContexts.filter(context => context.kind === "selected-source-text");
  return <>
    <OutlinedPanel title="Your notes" aria-label="Your notes" className="space-y-3">
      {notes.length === 0 && !editing && <p className="text-sm leading-relaxed text-muted-foreground">What made this worth saving? Leave a thought for your future self.</p>}
      {notes.map(note => <div key={note.id} className="space-y-2">
        <p className="whitespace-pre-wrap break-words text-sm">{note.text}</p>
        {editable && <div className="flex gap-2">
          <Button variant="ghost" disabled={mutation.isPending || editing !== null} onClick={() => { setEditing({ id: note.id, text: note.text }); setError(""); setNotice(""); }}>Edit note</Button>
          <Button variant="ghost" disabled={mutation.isPending || editing !== null} onClick={() => save({ action: "remove", noteId: note.id })}>Remove note</Button>
        </div>}
      </div>)}
      {editable && !editing && <Button variant="ghost" disabled={mutation.isPending} onClick={() => { setEditing({ text: "" }); setError(""); setNotice(""); }}>Add note</Button>}
      {editable && editing && <form noValidate className="space-y-2" onSubmit={event => { event.preventDefault(); save(editing.id === undefined ? { action: "add", text: editing.text } : { action: "edit", noteId: editing.id, text: editing.text }); }}>
        <Label htmlFor={`personal-note-${item.id}`}>Personal note</Label>
        <Textarea id={`personal-note-${item.id}`} autoFocus value={editing.text} disabled={mutation.isPending} aria-invalid={Boolean(error)} aria-describedby={error ? `note-error-${item.id}` : undefined} onChange={event => setEditing({ ...editing, text: event.target.value })} />
        <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Saving…" : "Save note"}</Button>
        <Button type="button" variant="ghost" disabled={mutation.isPending} onClick={() => { setEditing(null); setError(""); }}>Cancel</Button>
      </form>}
      {error && <p id={`note-error-${item.id}`} role="alert" className="text-sm">{error}</p>}
      {item.noteIndexing === "processing" && <p role="status" className="text-sm text-muted-foreground">Updating search for your notes…</p>}
      {item.noteIndexing === "incomplete" && <div><p className="text-sm">Your notes are saved, but search couldn’t be updated.</p>{editable && <Button variant="outline" disabled={mutation.isPending} onClick={() => save({ action: "retry" })}>Retry note search</Button>}</div>}
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    </OutlinedPanel>
    {selections.length > 0 && <OutlinedPanel title="Selected text" aria-label="Selected text" className="space-y-2">
      <p className="text-xs text-muted-foreground">Saved from the source.</p>
      {selections.map(selection => <blockquote key={selection.id} className="whitespace-pre-wrap break-words border-l pl-3 text-sm">{selection.text}</blockquote>)}
    </OutlinedPanel>}
  </>;
}

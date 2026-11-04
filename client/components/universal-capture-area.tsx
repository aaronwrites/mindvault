"use client";

import { type FormEvent, type ReactNode, useEffect, useEffectEvent, useRef, useState } from "react";
import { Plus, ArrowUpRight } from "lucide-react";
import { ProcessingIndicator } from "@/components/processing-indicator";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCapture, createOriginalFileCapture } from "@/lib/api";
import type { KnowledgeItem } from "@/lib/types";

type SaveEntry = {
  id: number;
  source: string | File;
  status: "saving" | "saved" | "duplicate" | "failed";
  guidance?: string;
};

const linkGuidance = "Paste a public link starting with https:// or http://, or choose a file with Add.";

function isEditable(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"], [role="combobox"], [role="dialog"]'));
}

export function UniversalCaptureArea({ children, onSaved, onDuplicate, disabled = false }: {
  children: ReactNode | ((captureControls: ReactNode) => ReactNode);
  onSaved: (item: KnowledgeItem) => void | Promise<void>;
  onDuplicate: (item: KnowledgeItem) => void | Promise<void>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [notice, setNotice] = useState("");
  const [entries, setEntries] = useState<SaveEntry[]>([]);
  const [dragging, setDragging] = useState(false);
  const nextId = useRef(0);
  const dragDepth = useRef(0);
  const pending = useRef(new Set<string | File>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const scheduled = timers.current;
    return () => { for (const timer of scheduled) clearTimeout(timer); };
  }, []);

  function clearDrag() {
    dragDepth.current = 0;
    setDragging(false);
  }

  useEffect(() => {
    // A drag cancelled outside the board must not leave the overlay behind.
    const clear = () => { dragDepth.current = 0; setDragging(false); };
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
      window.removeEventListener("blur", clear);
    };
  }, []);

  function updateEntry(id: number, status: SaveEntry["status"], guidance?: string) {
    setEntries(current => current.map(entry => entry.id === id ? { ...entry, status, guidance } : entry));
  }

  async function save(entry: SaveEntry) {
    // This lock is synchronous: repeated drops, submits, or retry clicks cannot
    // start another request for the same selection while one is still pending.
    if (pending.current.has(entry.source)) return;
    pending.current.add(entry.source);
    updateEntry(entry.id, "saving");
    let result;
    try {
      result = typeof entry.source === "string"
        ? await createCapture({ url: entry.source })
        : await createOriginalFileCapture({ file: entry.source });
    } catch (error) {
      const fileGuidance: Record<string, string> = {
        "file-too-large": "This file is too large. Choose a smaller file with Add.",
        "empty-file": "This file is empty. Choose a file with content using Add.",
        "prohibited-file": "This file type can’t be saved. Choose another file with Add.",
      };
      updateEntry(entry.id, "failed", typeof entry.source !== "string" && error instanceof Error ? fileGuidance[error.message] : undefined);
      pending.current.delete(entry.source);
      return;
    }
    pending.current.delete(entry.source);
    const duplicate = typeof entry.source === "string" && result.reused;
    updateEntry(entry.id, duplicate ? "duplicate" : "saved");
    const timer = setTimeout(() => {
      setEntries(current => current.filter(saved => saved.id !== entry.id));
      timers.current.delete(timer);
    }, 6000);
    timers.current.add(timer);
    try {
      await onSaved(result.knowledgeItem);
      if (duplicate) await onDuplicate(result.knowledgeItem);
    } catch {
      // A board update failure cannot turn a durable save into a retryable upload.
      setNotice("Saved, but the board couldn’t update. Reload to see your save.");
    }
  }

  function enqueue(source: SaveEntry["source"]) {
    if (pending.current.has(source)) return;
    const entry: SaveEntry = { id: nextId.current++, source, status: "saving" };
    setEntries(current => [...current, entry]);
    void save(entry);
  }

  function saveUrl(value: string) {
    try {
      const link = new URL(value.trim());
      if (!["http:", "https:"].includes(link.protocol)) throw new Error();
      setNotice("");
      enqueue(link.href);
      setUrl("");
      setOpen(false);
    } catch {
      setNotice(linkGuidance);
    }
  }

  function saveLink(event: FormEvent) {
    event.preventDefault();
    saveUrl(url);
  }

  function saveFiles(files: File[]) {
    setNotice("");
    files.forEach(enqueue);
    setOpen(false);
  }

  const handlePaste = useEffectEvent((event: ClipboardEvent) => {
    if (disabled || open || isEditable(event.target) || isEditable(document.activeElement)) return;
    const value = event.clipboardData?.getData("text/plain") ?? "";
    if (!value.trim()) return;
    event.preventDefault();
    saveUrl(value);
  });

  useEffect(() => {
    const paste = (event: ClipboardEvent) => handlePaste(event);
    document.addEventListener("paste", paste);
    return () => document.removeEventListener("paste", paste);
  }, []);

  const handleFileDrag = useEffectEvent((event: DragEvent) => {
    if (event.type === "drop") clearDrag();
    const transfer = event.dataTransfer;
    if (!transfer || !Array.from(transfer.types).includes("Files")) return;
    // File drops must never navigate away, including while a modal or Trash
    // temporarily disables capture shortcuts.
    if (event.type !== "dragleave") event.preventDefault();
    const excluded = disabled || open || Boolean(document.querySelector('[role="dialog"], [role="alertdialog"]'));
    if (event.type === "dragover") {
      transfer.dropEffect = excluded ? "none" : "copy";
    } else if (event.type === "dragleave") {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    } else if (!excluded && event.type === "dragenter") {
      dragDepth.current++;
      setDragging(true);
    } else if (!excluded && event.type === "drop") {
      const files = Array.from(transfer.files);
      if (files.length) saveFiles(files);
      else setNotice("Drop files from your device, or choose them with Add. Folders can’t be saved here.");
    }
  });

  useEffect(() => {
    const handle = (event: DragEvent) => handleFileDrag(event);
    const events = ["dragenter", "dragover", "dragleave", "drop"] as const;
    for (const name of events) document.addEventListener(name, handle);
    return () => { for (const name of events) document.removeEventListener(name, handle); };
  }, []);

  const captureControls = <Dialog open={open} onOpenChange={setOpen}>
      <div className="capture-controls">
        {!disabled && <p className="capture-hint">Paste a link or drop files</p>}
        <DialogTrigger render={<Button className="h-11 px-4" />}><Plus aria-hidden="true" />Add</DialogTrigger>
      </div>
      <DialogContent className="capture-dialog">
        <DialogHeader className="pr-12"><DialogTitle>Add to your vault</DialogTitle><DialogDescription>Save a link or choose files.{!disabled && " You can also paste a link or drop files onto the board."}</DialogDescription></DialogHeader>
        <form onSubmit={saveLink} className="capture-link-section space-y-3">
          <Label htmlFor="save-link" className="section-label">Link</Label>
          <Input id="save-link" type="url" required value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.com/article" />
          <Button type="submit">Save link<ArrowUpRight aria-hidden="true" /></Button>
        </form>
        <div className="capture-file-section space-y-3"><Label htmlFor="save-files" className="section-label">Choose files</Label>
          <p id="file-support" className="text-sm text-muted-foreground">Text PDFs and scanned PDFs with printed English text can be searched. Other files are retained for opening or downloading; understanding their contents is not available yet. Executables and archives aren’t accepted.</p>
          <Input id="save-files" type="file" multiple aria-describedby="file-support" onChange={event => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length) saveFiles(files);
        }} /></div>
        {notice && <p role="alert">{notice}</p>}
      </DialogContent>
    </Dialog>;
  return <div className="capture-workspace">
    {typeof children === "function" ? children(captureControls) : captureControls}
    <div aria-live="polite" aria-atomic="false" className={entries.length || (!open && notice) ? "my-3 space-y-2 text-sm" : "space-y-2 text-sm"}>
      {!open && notice && <p role="alert">{notice}</p>}
      {entries.map(entry => {
        const file = typeof entry.source !== "string";
        const label = typeof entry.source === "string" ? entry.source : entry.source.name;
        return <div key={entry.id} data-state={entry.status} className="capture-entry flex flex-wrap items-center gap-2" role={entry.status === "saving" ? undefined : entry.status === "failed" ? "alert" : "status"}>
          {entry.status === "saving" ? <ProcessingIndicator kind="capture" label={`${file ? "Uploading" : "Saving link"} ${label}…`} className="min-w-0 flex-1 break-all" /> : <span className="min-w-0 flex-1 break-all">{entry.status === "duplicate" ? <><span>Already saved</span>{` — ${label}`}</>
            : entry.status === "failed" ? `Couldn’t save ${label}. ${entry.guidance ?? `Check your connection and try again${file ? ", or choose the file again with Add" : ", or check that the link is public"}.`}`
            : `Saved — ${label}`}</span>}
          {entry.status === "failed" && <Button size="sm" variant="outline" aria-label={`Retry ${label}`} onClick={() => void save(entry)}>Retry</Button>}
          {entry.status !== "saving" && <Button size="sm" variant="ghost" aria-label={`Dismiss save message for ${label}`} onClick={() => setEntries(current => current.filter(saved => saved.id !== entry.id))}>Dismiss</Button>}
        </div>;
      })}
    </div>
    {typeof children !== "function" && children}
    {dragging && !disabled && !open && <div role="status" className="pointer-events-none fixed inset-4 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-background/95 text-lg font-medium">Drop files to save</div>}
  </div>;
}

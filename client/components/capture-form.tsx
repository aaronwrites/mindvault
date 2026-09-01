"use client";

import { type DragEvent, type FormEvent, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { createCapture, createOriginalFileCapture } from "@/lib/api";
import type { CaptureResponse, KnowledgeItem } from "@/lib/types";

type CaptureMode = "url" | "file";

export function CaptureForm({ onCaptured }: { onCaptured: (knowledgeItem: KnowledgeItem) => void | Promise<void> }) {
  const [mode, setMode] = useState<CaptureMode>("url");
  const [url, setUrl] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [personalNote, setPersonalNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [filePhase, setFilePhase] = useState<string | null>(null);
  const [captureMessage, setCaptureMessage] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const captureMutation = useMutation({
    mutationFn: async (): Promise<CaptureResponse> => {
      if (mode === "url") return createCapture({ url: url.trim(), ...(selectedText.trim() && { selectedText: selectedText.trim() }), ...(personalNote.trim() && { personalNote: personalNote.trim() }) });

      if (!file) throw new Error("Choose one Original File to capture.");
      setFilePhase("Preparing file…");
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      setFilePhase("Uploading securely…");
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      setFilePhase("Saving Capture…");
      return createOriginalFileCapture({ file, ...(personalNote.trim() && { personalNote: personalNote.trim() }) });
    },
    onSuccess: async ({ knowledgeItem, reused, restoredFromTrash }) => {
      setUrl("");
      setSelectedText("");
      setPersonalNote("");
      setFile(null);
      setFilePhase(null);
      if (fileInput.current) fileInput.current.value = "";
      setCaptureMessage(restoredFromTrash ? "Restored the existing Knowledge Item from Trash." : reused ? "Reused the existing Knowledge Item." : null);
      await onCaptured(knowledgeItem);
    },
    onError: () => setFilePhase(null),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    captureMutation.mutate();
  }
  function chooseFile(nextFile: File | null) {
    if (nextFile) {
      setSelectionError(null);
      setFile(nextFile);
      setMode("file");
    }
  }
  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (event.dataTransfer.files.length !== 1) {
      setSelectionError("Capture accepts exactly one Original File at a time.");
      return;
    }
    chooseFile(event.dataTransfer.files.item(0));
  }

  const isFileMode = mode === "file";
  return (
    <Card aria-labelledby="capture-heading">
      <CardHeader>
        <CardTitle id="capture-heading" className="text-xl">Capture knowledge</CardTitle>
        <CardDescription>Capture one link or one Original File. Files are retained before MindVault attempts to understand them.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <fieldset className="grid gap-3" disabled={captureMutation.isPending}>
            <legend className="text-sm font-medium">What would you like to capture?</legend>
            <RadioGroup value={mode} onValueChange={(value) => setMode(value as CaptureMode)} className="grid gap-3 sm:grid-cols-2" aria-label="Capture type">
              <label className="flex gap-2 rounded-2xl border p-3 has-[[data-checked]]:border-primary"><RadioGroupItem value="url" aria-label="Link" /><span><span className="font-medium">Link</span><span className="mt-1 block text-sm text-muted-foreground">Capture a public HTTP(S) address.</span></span></label>
              <label className="flex gap-2 rounded-2xl border p-3 has-[[data-checked]]:border-primary"><RadioGroupItem value="file" aria-label="File" /><span><span className="font-medium">File</span><span className="mt-1 block text-sm text-muted-foreground">Retain one file in its original form.</span></span></label>
            </RadioGroup>
          </fieldset>
          {isFileMode ? (
            <div className="space-y-2">
              <Label htmlFor="capture-file">Choose Original File</Label>
              <Input ref={fileInput} id="capture-file" type="file" onChange={(event) => chooseFile(event.target.files?.item(0) ?? null)} disabled={captureMutation.isPending} />
              <div role="button" tabIndex={0} className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop} onClick={() => fileInput.current?.click()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); fileInput.current?.click(); } }}>
                Drag one file here or choose it above.
              </div>
              {file && <p className="text-sm text-muted-foreground">Selected: {file.name}</p>}
            </div>
          ) : <>
            <div className="space-y-2"><Label htmlFor="capture-url">URL</Label><Input id="capture-url" required type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/article" /></div>
            <div className="space-y-2"><Label htmlFor="capture-selected-text">Selected source text (optional)</Label><Textarea id="capture-selected-text" value={selectedText} onChange={(event) => setSelectedText(event.target.value)} className="min-h-20" /></div>
          </>}
          <div className="space-y-2"><Label htmlFor="capture-personal-note">Personal note (optional)</Label><Textarea id="capture-personal-note" value={personalNote} onChange={(event) => setPersonalNote(event.target.value)} className="min-h-20" disabled={captureMutation.isPending} /></div>
          <p className="text-sm text-muted-foreground">Switching capture type preserves what you entered, but submits only the selected source.</p>
          {filePhase && <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{filePhase}</p>}
          {captureMessage && <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{captureMessage}</p>}
          {selectionError && <Alert variant="destructive"><AlertDescription>{selectionError}</AlertDescription></Alert>}
          {captureMutation.error && <Alert variant="destructive"><AlertDescription>{captureMutation.error.message}</AlertDescription></Alert>}
          <div><Button type="submit" size="lg" disabled={captureMutation.isPending}>{captureMutation.isPending ? (filePhase ?? "Capturing…") : isFileMode ? "Capture file to MindVault" : "Capture to MindVault"}</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}

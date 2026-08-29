"use client";

import { FormEvent, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createCapture } from "@/lib/api";
import type { KnowledgeItem } from "@/lib/types";

export function CaptureForm({
  onCaptured,
}: {
  onCaptured: (knowledgeItem: KnowledgeItem) => void | Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [personalNote, setPersonalNote] = useState("");
  const captureMutation = useMutation({
    mutationFn: createCapture,
    onSuccess: async ({ knowledgeItem }) => {
      setUrl("");
      setSelectedText("");
      setPersonalNote("");
      await onCaptured(knowledgeItem);
    },
  });
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    captureMutation.mutate({
      url: url.trim(),
      ...(selectedText.trim() && { selectedText: selectedText.trim() }),
      ...(personalNote.trim() && { personalNote: personalNote.trim() }),
    });
  }
  return (
    <Card aria-labelledby="capture-heading">
      <CardHeader>
        <CardTitle id="capture-heading" className="text-xl">
          Capture knowledge
        </CardTitle>
        <CardDescription>
          MindVault saves the link now and processes it in the background.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="capture-url">URL</Label>
            <Input
              id="capture-url"
              required
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/article"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="capture-selected-text">
              Selected source text (optional)
            </Label>
            <Textarea
              id="capture-selected-text"
              value={selectedText}
              onChange={(event) => setSelectedText(event.target.value)}
              className="min-h-20"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="capture-personal-note">
              Personal note (optional)
            </Label>
            <Textarea
              id="capture-personal-note"
              value={personalNote}
              onChange={(event) => setPersonalNote(event.target.value)}
              className="min-h-20"
            />
          </div>
          {captureMutation.error && (
            <Alert variant="destructive">
              <AlertDescription>
                {captureMutation.error.message}
              </AlertDescription>
            </Alert>
          )}
          <div>
            <Button
              type="submit"
              size="lg"
              disabled={captureMutation.isPending}
            >
              {captureMutation.isPending
                ? "Capturing…"
                : "Capture to MindVault"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

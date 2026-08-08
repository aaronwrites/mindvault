"use client";

import { FormEvent, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Resource, SourceType } from "@/lib/types";

type ResourceFormProps = {
  apiUrl: string;
  onCreated: (resource: Resource) => void;
};

const sourceTypes: { value: SourceType; label: string }[] = [
  { value: "article", label: "Article" },
  { value: "repo", label: "Repository" },
  { value: "video", label: "Video" },
  { value: "pdf", label: "PDF" },
  { value: "note", label: "Note" },
];

export function ResourceForm({ apiUrl, onCreated }: ResourceFormProps) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("article");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`${apiUrl}/resources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), url: url.trim(), sourceType }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.formErrors?.[0] ?? "Could not save this resource.");
      }

      const resource: Resource = await response.json();
      onCreated(resource);
      setTitle("");
      setUrl("");
      setSourceType("article");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not save this resource.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card aria-labelledby="add-resource-heading">
      <CardHeader>
        <CardTitle id="add-resource-heading" className="text-xl">Add a resource</CardTitle>
        <CardDescription>AI enrichment happens before the new card appears.</CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="resource-title">Title</Label>
            <Input
              id="resource-title"
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Understanding TypeScript generics"
              className="h-10"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="resource-type">Type</Label>
            <Select
              value={sourceType}
              onValueChange={(value) => setSourceType(value as SourceType)}
            >
              <SelectTrigger id="resource-type" className="h-10 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sourceTypes.map((type) => (
                  <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="resource-url">URL</Label>
            <Input
              id="resource-url"
              required
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/article"
              className="h-10"
            />
          </div>

          {error && (
            <Alert variant="destructive" className="sm:col-span-2">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="sm:col-span-2">
            <Button type="submit" size="lg" disabled={isSubmitting}>
              {isSubmitting ? "Saving and enriching…" : "Save to MindVault"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { createResource, resourceKeys } from "@/lib/api";
import type { SourceType } from "@/lib/types";

type ResourceFormProps = {
  onCreated: () => void;
};

const sourceTypes: { value: SourceType; label: string }[] = [
  { value: "article", label: "Article" },
  { value: "repo", label: "Repository" },
  { value: "video", label: "Video" },
  { value: "pdf", label: "PDF" },
  { value: "note", label: "Note" },
];

export function ResourceForm({ onCreated }: ResourceFormProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("article");
  const createMutation = useMutation({
    mutationFn: createResource,
    onSuccess: async () => {
      setTitle("");
      setUrl("");
      setSourceType("article");
      onCreated();
      await queryClient.invalidateQueries({ queryKey: resourceKeys.all });
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createMutation.mutate({ title: title.trim(), url: url.trim(), sourceType });
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

          {createMutation.error && (
            <Alert variant="destructive" className="sm:col-span-2">
              <AlertDescription>{createMutation.error.message}</AlertDescription>
            </Alert>
          )}

          <div className="sm:col-span-2">
            <Button type="submit" size="lg" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Saving and enriching…" : "Save to MindVault"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

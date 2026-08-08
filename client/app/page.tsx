"use client";

import { useCallback, useEffect, useState } from "react";
import { ResourceCard } from "@/components/resource-card";
import { ResourceForm } from "@/components/resource-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Resource } from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function Home() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadResources = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch(`${API_URL}/resources`);
      if (!response.ok) throw new Error("Could not load your resources.");
      setResources(await response.json());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load your resources.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let isCurrent = true;

    fetch(`${API_URL}/resources`)
      .then((response) => {
        if (!response.ok) throw new Error("Could not load your resources.");
        return response.json() as Promise<Resource[]>;
      })
      .then((data) => {
        if (isCurrent) setResources(data);
      })
      .catch((loadError: unknown) => {
        if (isCurrent) {
          setError(loadError instanceof Error ? loadError.message : "Could not load your resources.");
        }
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-12 px-6 py-12 sm:px-10 lg:py-20">
      <header className="space-y-3">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">MindVault</p>
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Save it now. Find it when it matters.
        </h1>
        <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
          Add a developer resource and MindVault will generate a summary and tags for you.
        </p>
      </header>

      <ResourceForm
        apiUrl={API_URL}
        onCreated={(resource) => setResources((current) => [resource, ...current])}
      />

      <section aria-labelledby="resources-heading" className="space-y-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 id="resources-heading" className="text-2xl font-semibold tracking-tight">Your resources</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {resources.length} {resources.length === 1 ? "resource" : "resources"} saved
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => void loadResources()}
          >
            Refresh
          </Button>
        </div>

        {isLoading && (
          <Card>
            <CardContent className="py-3 text-center text-muted-foreground">Loading resources…</CardContent>
          </Card>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error} Make sure the API is running at {API_URL}.</AlertDescription>
          </Alert>
        )}
        {!isLoading && !error && resources.length === 0 && (
          <Card>
            <CardContent className="py-3 text-center text-muted-foreground">
              Your vault is empty. Add the first link above.
            </CardContent>
          </Card>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          {resources.map((resource) => <ResourceCard key={resource.id} resource={resource} />)}
        </div>
      </section>
    </main>
  );
}

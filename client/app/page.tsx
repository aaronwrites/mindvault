"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ResourceCard } from "@/components/resource-card";
import { ResourceForm } from "@/components/resource-form";
import { SearchForm } from "@/components/search-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { API_URL, getResources, resourceKeys, searchResources } from "@/lib/api";

export default function Home() {
  const queryClient = useQueryClient();
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
  const resourcesQuery = useQuery({
    queryKey: activeQuery ? resourceKeys.search(activeQuery) : resourceKeys.all,
    queryFn: () => activeQuery ? searchResources(activeQuery) : getResources(),
  });
  const resources = resourcesQuery.data ?? [];

  function showAllResources() {
    setActiveQuery(null);
    void queryClient.invalidateQueries({ queryKey: resourceKeys.all });
  }

  function search(query: string) {
    if (query === activeQuery) {
      void resourcesQuery.refetch();
      return;
    }

    setActiveQuery(query);
  }

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

      <ResourceForm onCreated={() => setActiveQuery(null)} />

      <SearchForm
        onSearch={search}
        onClear={showAllResources}
        isSearching={resourcesQuery.isFetching && activeQuery !== null}
      />

      <section aria-labelledby="resources-heading" className="space-y-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 id="resources-heading" className="text-2xl font-semibold tracking-tight">
              {activeQuery ? `Results for “${activeQuery}”` : "Your resources"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {resources.length} {resources.length === 1 ? "resource" : "resources"} {activeQuery ? "found" : "saved"}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={showAllResources}
            disabled={resourcesQuery.isFetching}
          >
            Refresh
          </Button>
        </div>

        {resourcesQuery.isPending && (
          <Card>
            <CardContent className="py-3 text-center text-muted-foreground">Loading resources…</CardContent>
          </Card>
        )}
        {resourcesQuery.error && (
          <Alert variant="destructive">
            <AlertDescription>{resourcesQuery.error.message} Make sure the API is running at {API_URL}.</AlertDescription>
          </Alert>
        )}
        {!resourcesQuery.isPending && !resourcesQuery.error && resources.length === 0 && (
          <Card>
            <CardContent className="py-3 text-center text-muted-foreground">
              {activeQuery ? "No semantically similar resources were found." : "Your vault is empty. Add the first link above."}
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

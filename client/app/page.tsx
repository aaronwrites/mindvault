"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CaptureForm } from "@/components/capture-form";
import { KnowledgeItemCard } from "@/components/knowledge-item-card";
import { RecallResultCard } from "@/components/recall-result-card";
import { SearchForm } from "@/components/search-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { getKnowledgeItems, knowledgeItemKeys, recallKeys, refreshKnowledgeItem, retryKnowledgeItem, searchKnowledgeItems } from "@/lib/api";
import type { KnowledgeItem } from "@/lib/types";

export default function Home() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const knowledgeItemsQuery = useQuery({
    queryKey: knowledgeItemKeys.all,
    queryFn: getKnowledgeItems,
    refetchInterval: (query) =>
      query.state.data?.some(
        (item) =>
          item.availability === "processing" ||
          (item.availability === "ready" && item.organizationCondition !== "complete"),
      )
        ? 2_000
        : false,
    refetchIntervalInBackground: true,
  });
  const knowledgeItems = knowledgeItemsQuery.data ?? [];
  async function updateKnowledgeItemAfterProcessingAttempt({ knowledgeItem }: { knowledgeItem: KnowledgeItem }) {
    queryClient.setQueryData<KnowledgeItem[]>(
      knowledgeItemKeys.all,
      (current) =>
        (current ?? []).map((item) =>
          item.id === knowledgeItem.id ? knowledgeItem : item,
        ),
    );
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: knowledgeItemKeys.all }),
      queryClient.invalidateQueries({ queryKey: recallKeys.all }),
    ]);
  }
  const refreshMutation = useMutation({
    mutationFn: refreshKnowledgeItem,
    onSuccess: updateKnowledgeItemAfterProcessingAttempt,
  });
  const retryMutation = useMutation({
    mutationFn: retryKnowledgeItem,
    onSuccess: updateKnowledgeItemAfterProcessingAttempt,
  });
  const recallQuery = useQuery({
    queryKey: recallKeys.search(searchQuery),
    queryFn: () => searchKnowledgeItems(searchQuery),
    enabled: Boolean(searchQuery),
  });
  async function showCapturedItem(knowledgeItem: KnowledgeItem) {
    await queryClient.cancelQueries({ queryKey: knowledgeItemKeys.all });
    queryClient.setQueryData<KnowledgeItem[]>(
      knowledgeItemKeys.all,
      (current) => [
        knowledgeItem,
        ...(current ?? []).filter((item) => item.id !== knowledgeItem.id),
      ],
    );
  }
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-12 px-6 py-12 sm:px-10 lg:py-20">
      <header className="space-y-3">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          MindVault
        </p>
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Save it now. Find it when it matters.
        </h1>
        <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
          Capture useful knowledge without interrupting your flow.
        </p>
      </header>
      <CaptureForm onCaptured={showCapturedItem} />
      <section aria-labelledby="recall-heading" className="space-y-4">
        <div>
          <h2 id="recall-heading" className="text-2xl font-semibold tracking-tight">Recall your Knowledge Items</h2>
          <p className="mt-1 text-sm text-muted-foreground">Search by meaning or exact language such as an error message, command, or identifier.</p>
        </div>
        <SearchForm onSearch={setSearchQuery} onClear={() => setSearchQuery("")} isSearching={recallQuery.isFetching} />
        {searchQuery && recallQuery.isPending && <Card role="status"><CardContent className="py-3 text-center text-muted-foreground">Searching your captured knowledge…</CardContent></Card>}
        {searchQuery && recallQuery.error && <Alert variant="destructive"><AlertDescription>{recallQuery.error.message}</AlertDescription></Alert>}
        {searchQuery && !recallQuery.isPending && !recallQuery.error && recallQuery.data?.length === 0 && (
          <Card><CardContent className="py-3 text-center text-muted-foreground">No Ready Knowledge Items matched that recall. Try a related idea or the exact wording you remember.</CardContent></Card>
        )}
        {recallQuery.data && recallQuery.data.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2">{recallQuery.data.map(result => <RecallResultCard key={result.id} result={result} />)}</div>
        )}
      </section>
      <section aria-labelledby="knowledge-items-heading" className="space-y-5">
        <div>
          <div>
            <h2
              id="knowledge-items-heading"
              className="text-2xl font-semibold tracking-tight"
            >
              Your Knowledge Items
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {knowledgeItems.length}{" "}
              {knowledgeItems.length === 1 ? "item" : "items"} captured
            </p>
          </div>
        </div>
        {knowledgeItemsQuery.isPending && (
          <Card role="status">
            <CardContent className="py-3 text-center text-muted-foreground">
              Loading Knowledge Items…
            </CardContent>
          </Card>
        )}
        {knowledgeItemsQuery.error && (
          <Alert variant="destructive">
            <AlertDescription>
              {knowledgeItemsQuery.error.message}
            </AlertDescription>
          </Alert>
        )}
        {refreshMutation.error && (
          <Alert variant="destructive">
            <AlertDescription>{refreshMutation.error.message}</AlertDescription>
          </Alert>
        )}
        {retryMutation.error && (
          <Alert variant="destructive">
            <AlertDescription>{retryMutation.error.message}</AlertDescription>
          </Alert>
        )}
        {!knowledgeItemsQuery.isPending &&
          !knowledgeItemsQuery.error &&
          knowledgeItems.length === 0 && (
            <Card>
              <CardContent className="py-3 text-center text-muted-foreground">
                Your vault is empty. Capture your first link above.
              </CardContent>
            </Card>
          )}
        <div className="grid gap-4 md:grid-cols-2">
          {knowledgeItems.map((knowledgeItem) => (
            <KnowledgeItemCard
              key={knowledgeItem.id}
              knowledgeItem={knowledgeItem}
              onRefresh={(knowledgeItemId) => refreshMutation.mutate(knowledgeItemId)}
              onRetry={(knowledgeItemId) => retryMutation.mutate(knowledgeItemId)}
              isRefreshing={refreshMutation.isPending && refreshMutation.variables === knowledgeItem.id}
              isRetrying={retryMutation.isPending && retryMutation.variables === knowledgeItem.id}
            />
          ))}
        </div>
      </section>
    </main>
  );
}

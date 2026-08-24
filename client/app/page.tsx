"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CaptureForm } from "@/components/capture-form";
import { KnowledgeItemCard } from "@/components/knowledge-item-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { getKnowledgeItems, knowledgeItemKeys } from "@/lib/api";
import type { KnowledgeItem } from "@/lib/types";

export default function Home() {
  const queryClient = useQueryClient();
  const knowledgeItemsQuery = useQuery({
    queryKey: knowledgeItemKeys.all,
    queryFn: getKnowledgeItems,
    refetchInterval: (query) =>
      query.state.data?.some(
        (item) =>
          item.availability === "processing" ||
          item.organizationCondition !== "complete",
      )
        ? 2_000
        : false,
    refetchIntervalInBackground: true,
  });
  const knowledgeItems = knowledgeItemsQuery.data ?? [];
  function showCapturedItem(knowledgeItem: KnowledgeItem) {
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
            />
          ))}
        </div>
      </section>
    </main>
  );
}

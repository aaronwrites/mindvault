"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CaptureForm } from "@/components/capture-form";
import { KnowledgeItemCard } from "@/components/knowledge-item-card";
import { originalFileTitle, sourcePreviewTitle } from "@/components/source-preview";
import { RecallResultCard } from "@/components/recall-result-card";
import { SearchForm } from "@/components/search-form";
import { SynthesisForm } from "@/components/synthesis-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { askVault, getKnowledgeItems, getTrashedKnowledgeItems, knowledgeItemKeys, permanentlyDeleteKnowledgeItem, recallKeys, refreshKnowledgeItem, restoreKnowledgeItem, retryKnowledgeItem, searchKnowledgeItems, trashKnowledgeItem } from "@/lib/api";
import type { KnowledgeItem, SynthesisResult } from "@/lib/types";

type ConversationTurn = {
  question: string;
  result: SynthesisResult;
};

export default function Home() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [showTrash, setShowTrash] = useState(false);
  const [permanentDeletionTarget, setPermanentDeletionTarget] = useState<KnowledgeItem | null>(null);
  const [synthesisQuestion, setSynthesisQuestion] = useState("");
  const [conversationTurns, setConversationTurns] = useState<ConversationTurn[]>([]);
  const knowledgeItemsQuery = useQuery({
    queryKey: knowledgeItemKeys.all,
    queryFn: getKnowledgeItems,
    refetchInterval: (query) =>
      query.state.data?.some(
        (item) =>
          item.availability === "processing" ||
          (item.availability === "ready" && (
            item.organizationCondition !== "complete" ||
            (item.latestAttempt?.kind === "refresh" &&
              (item.latestAttempt.status === "pending" || item.latestAttempt.status === "running"))
          )),
      )
        ? 2_000
        : false,
    refetchIntervalInBackground: true,
  });
  const knowledgeItems = knowledgeItemsQuery.data ?? [];
  const trashQuery = useQuery({ queryKey: knowledgeItemKeys.trash, queryFn: getTrashedKnowledgeItems, enabled: showTrash, refetchInterval: query => query.state.data?.some(item => item.lifecycleState === "pending-permanent-deletion") ? 2_000 : false });
  const trashedKnowledgeItems = trashQuery.data ?? [];
  const permanentDeletionLabel = permanentDeletionTarget
    ? permanentDeletionTarget.source.filename !== undefined
      ? originalFileTitle(permanentDeletionTarget.source.filename, permanentDeletionTarget.source.kind)
      : sourcePreviewTitle(permanentDeletionTarget.sourcePreview, permanentDeletionTarget.source.submittedUrl)
    : "this Knowledge Item";
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
  const trashMutation = useMutation({
    mutationFn: trashKnowledgeItem,
    onSuccess: async (_, id) => {
      queryClient.setQueryData<KnowledgeItem[]>(knowledgeItemKeys.all, current => (current ?? []).filter(item => item.id !== id));
      await Promise.all([queryClient.invalidateQueries({ queryKey: knowledgeItemKeys.trash }), queryClient.invalidateQueries({ queryKey: recallKeys.all })]);
    },
  });
  const restoreMutation = useMutation({
    mutationFn: restoreKnowledgeItem,
    onSuccess: async ({ knowledgeItem }, id) => {
      queryClient.setQueryData<KnowledgeItem[]>(knowledgeItemKeys.trash, current => (current ?? []).filter(item => item.id !== id));
      queryClient.setQueryData<KnowledgeItem[]>(knowledgeItemKeys.all, current => [knowledgeItem, ...(current ?? []).filter(item => item.id !== knowledgeItem.id)]);
      await Promise.all([queryClient.invalidateQueries({ queryKey: knowledgeItemKeys.all }), queryClient.invalidateQueries({ queryKey: knowledgeItemKeys.trash }), queryClient.invalidateQueries({ queryKey: recallKeys.all })]);
    },
  });
  const permanentlyDeleteMutation = useMutation({
    mutationFn: permanentlyDeleteKnowledgeItem,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: knowledgeItemKeys.trash });
    },
  });
  function confirmPermanentDeletion(knowledgeItem: KnowledgeItem) { setPermanentDeletionTarget(knowledgeItem); }
  const recallQuery = useQuery({
    queryKey: recallKeys.search(searchQuery),
    queryFn: () => searchKnowledgeItems(searchQuery),
    enabled: Boolean(searchQuery),
  });
  const synthesisMutation = useMutation({
    mutationFn: askVault,
  });
  function askQuestion(question: string) {
    synthesisMutation.mutate({
      question,
      conversation: conversationTurns.slice(-6).map(turn => ({ question: turn.question, answer: turn.result.answer })),
    }, {
      onSuccess: result => {
        setConversationTurns(turns => [...turns, { question, result }]);
        setSynthesisQuestion("");
      },
    });
  }
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
      {!showTrash && <CaptureForm onCaptured={showCapturedItem} />}
      {!showTrash && <section aria-labelledby="recall-heading" className="space-y-4">
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
      </section>}
      {!showTrash && <section aria-labelledby="synthesis-heading" className="space-y-4">
        <div>
          <h2 id="synthesis-heading" className="text-2xl font-semibold tracking-tight">Ask your vault</h2>
          <p className="mt-1 text-sm text-muted-foreground">Answers use only matching captured evidence and cite the Knowledge Items that support them.</p>
          <p className="mt-1 text-sm text-muted-foreground">Questions, matching evidence, and current-session context are processed by the configured external AI provider. Original Files are never shared.</p>
        </div>
        <SynthesisForm onAsk={askQuestion} isAsking={synthesisMutation.isPending} question={synthesisQuestion} onQuestionChange={setSynthesisQuestion} />
        {synthesisMutation.isPending && <Card role="status"><CardContent className="py-3 text-center text-muted-foreground">Finding relevant captured evidence…</CardContent></Card>}
        {synthesisMutation.error && <Alert variant="destructive"><AlertDescription>{synthesisMutation.error.message}</AlertDescription></Alert>}
        {conversationTurns.length > 0 && <section aria-label="Current conversation" className="space-y-4">
          {conversationTurns.map((turn, index) => <Card key={`${turn.question}-${index}`}>
            <CardContent className="space-y-4 py-5">
              <p className="text-sm font-medium">You asked: {turn.question}</p>
              <p>{turn.result.answer}</p>
              {turn.result.insufficientEvidence ? <p className="text-sm text-muted-foreground">Capture more relevant knowledge, then ask again.</p> : <section aria-label="Supporting Knowledge Items" className="space-y-3">
                <p className="text-sm font-medium">Supporting Knowledge Items</p>
                <ul className="space-y-3">
                  {turn.result.citations.map(citation => <li key={`${citation.knowledgeItemId}-${citation.sourceSnapshotId ?? "context"}`} className="space-y-1 text-sm">
                    <a className="font-medium underline underline-offset-4" href={`#knowledge-item-${citation.knowledgeItemId}`}>View {citation.title}</a>
                    <blockquote className="border-l-2 pl-3 text-muted-foreground">{citation.excerpt}</blockquote>
                    {citation.evidenceCoverage === "metadata-only" && <p className="text-muted-foreground">Based on source-provided metadata only.</p>}
                  </li>)}
                </ul>
              </section>}
            </CardContent>
          </Card>)}
        </section>}
      </section>}
      <section aria-labelledby="knowledge-items-heading" className="space-y-5">
        <div>
          <div>
            <h2
              id="knowledge-items-heading"
              className="text-2xl font-semibold tracking-tight"
            >
              {showTrash ? "Trash" : "Your Knowledge Items"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {showTrash ? `${trashedKnowledgeItems.length} ${trashedKnowledgeItems.length === 1 ? "item" : "items"} retained in Trash.` : `${knowledgeItems.length} ${knowledgeItems.length === 1 ? "item" : "items"} captured`}
            </p>
            <Button variant="outline" className="mt-3" onClick={() => setShowTrash(value => !value)}>{showTrash ? "Back to Knowledge Items" : "View Trash"}</Button>
          </div>
        </div>
        {(showTrash ? trashQuery.isPending : knowledgeItemsQuery.isPending) && (
          <Card role="status">
            <CardContent className="py-3 text-center text-muted-foreground">
              Loading Knowledge Items…
            </CardContent>
          </Card>
        )}
        {(showTrash ? trashQuery.error : knowledgeItemsQuery.error) && (
          <Alert variant="destructive">
            <AlertDescription>
              {(showTrash ? trashQuery.error : knowledgeItemsQuery.error)?.message}
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
        {trashMutation.error && <Alert variant="destructive"><AlertDescription>{trashMutation.error.message}</AlertDescription></Alert>}
        {restoreMutation.error && <Alert variant="destructive"><AlertDescription>{restoreMutation.error.message}</AlertDescription></Alert>}
        {permanentlyDeleteMutation.error && <Alert variant="destructive"><AlertDescription>{permanentlyDeleteMutation.error.message}</AlertDescription></Alert>}
        {!(showTrash ? trashQuery.isPending : knowledgeItemsQuery.isPending) &&
          !(showTrash ? trashQuery.error : knowledgeItemsQuery.error) &&
          (showTrash ? trashedKnowledgeItems : knowledgeItems).length === 0 && (
            <Card>
              <CardContent className="py-3 text-center text-muted-foreground">
                {showTrash ? "Trash is empty. Items you move here can be restored." : "Your vault is empty. Capture your first link above."}
              </CardContent>
            </Card>
          )}
        <div className="grid gap-4 md:grid-cols-2">
          {(showTrash ? trashedKnowledgeItems : knowledgeItems).map((knowledgeItem) => (
            <div id={`knowledge-item-${knowledgeItem.id}`} key={knowledgeItem.id}>
            <KnowledgeItemCard
              knowledgeItem={knowledgeItem}
              onRefresh={(knowledgeItemId) => refreshMutation.mutate(knowledgeItemId)}
              onRetry={(knowledgeItemId) => retryMutation.mutate(knowledgeItemId)}
              onTrash={(knowledgeItemId) => trashMutation.mutate(knowledgeItemId)}
              onRestore={(knowledgeItemId) => restoreMutation.mutate(knowledgeItemId)}
              onPermanentlyDelete={confirmPermanentDeletion}
              isRefreshing={refreshMutation.isPending && refreshMutation.variables === knowledgeItem.id}
              isRetrying={retryMutation.isPending && retryMutation.variables === knowledgeItem.id}
              isTrashing={trashMutation.isPending && trashMutation.variables === knowledgeItem.id}
              isRestoring={restoreMutation.isPending && restoreMutation.variables === knowledgeItem.id}
              isPermanentlyDeleting={permanentlyDeleteMutation.isPending && permanentlyDeleteMutation.variables === knowledgeItem.id}
            />
            </div>
          ))}
        </div>
      </section>
      <AlertDialog open={permanentDeletionTarget !== null} onOpenChange={open => { if (!open) setPermanentDeletionTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete permanently?</AlertDialogTitle>
            <AlertDialogDescription>This permanently removes “{permanentDeletionLabel}” and its retained provenance. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { if (permanentDeletionTarget) permanentlyDeleteMutation.mutate(permanentDeletionTarget.id); setPermanentDeletionTarget(null); }}>Delete permanently</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

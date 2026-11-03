"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { UniversalCaptureArea } from "@/components/universal-capture-area";
import { KnowledgeItemDialog } from "@/components/knowledge-item-dialog";
import { useItemNavigation } from "@/lib/use-item-navigation";
import { KnowledgeItemCard, isItemProcessing } from "@/components/knowledge-item-card";
import { originalFileTitle, sourcePreviewTitle } from "@/components/source-preview";
import { RecallResultCard } from "@/components/recall-result-card";
import { SearchForm } from "@/components/search-form";
import { PdfPageReference } from "@/components/pdf-page-reference";
import { PdfExtractionCoverage } from "@/components/pdf-extraction-coverage";
import { SynthesisForm } from "@/components/synthesis-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { askVault, getKnowledgeItems, getTrashedKnowledgeItems, knowledgeItemKeys, permanentlyDeleteKnowledgeItem, recallKeys, refreshKnowledgeItem, restoreKnowledgeItem, retryKnowledgeItem, searchKnowledgeItems, trashKnowledgeItem } from "@/lib/api";
import type { KnowledgeItem, RecallKnowledgeItem, SynthesisResult } from "@/lib/types";

type ConversationTurn = {
  question: string;
  result: SynthesisResult;
};

function newestFirst(a: KnowledgeItem, b: KnowledgeItem) { return Date.parse(b.createdAt) - Date.parse(a.createdAt); }

export default function Home() {
  const queryClient = useQueryClient();
  const { itemId, openItem, closeItem, returnFocus } = useItemNavigation();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchText, setSearchText] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [highlightedItemId, setHighlightedItemId] = useState<number | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const [permanentDeletionTarget, setPermanentDeletionTarget] = useState<KnowledgeItem | null>(null);
  const [synthesisQuestion, setSynthesisQuestion] = useState("");
  const [conversationTurns, setConversationTurns] = useState<ConversationTurn[]>([]);
  const knowledgeItemsQuery = useQuery({
    queryKey: knowledgeItemKeys.all,
    queryFn: getKnowledgeItems,
    refetchInterval: (query) =>
      query.state.data?.some(item => isItemProcessing(item) || item.organizationCondition === "incomplete")
        ? 2_000
        : false,
    refetchIntervalInBackground: true,
  });
  useEffect(() => {
    // Background enrichment updates library cards and any currently visible Recall results.
    if (knowledgeItemsQuery.dataUpdatedAt > 0) {
      void queryClient.invalidateQueries({ queryKey: recallKeys.all });
    }
  }, [knowledgeItemsQuery.dataUpdatedAt, queryClient]);
  const knowledgeItems = knowledgeItemsQuery.data ?? [];
  function actionErrorForSelectedItem() {
    return [refreshMutation, retryMutation, trashMutation, restoreMutation, permanentlyDeleteMutation]
      .find(mutation => mutation.variables === itemId && mutation.error)?.error?.message;
  }
  const trashQuery = useQuery({ queryKey: knowledgeItemKeys.trash, queryFn: getTrashedKnowledgeItems, enabled: showTrash, refetchInterval: query => query.state.data?.some(item => item.lifecycleState === "pending-permanent-deletion") ? 2_000 : false });
  const trashedKnowledgeItems = trashQuery.data ?? [];
  const permanentDeletionLabel = permanentDeletionTarget
    ? permanentDeletionTarget.source.filename !== undefined
      ? originalFileTitle(permanentDeletionTarget.source.filename, permanentDeletionTarget.source.kind)
      : sourcePreviewTitle(permanentDeletionTarget.sourcePreview, permanentDeletionTarget.source.submittedUrl)
    : "this Knowledge Item";
  async function updateKnowledgeItemAfterProcessingAttempt({ knowledgeItem }: { knowledgeItem: KnowledgeItem }) {
    queryClient.setQueryData(knowledgeItemKeys.detail(knowledgeItem.id), knowledgeItem);
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
      closeItem(id);
      await queryClient.cancelQueries({ queryKey: recallKeys.all });
      queryClient.setQueriesData<RecallKnowledgeItem[]>({ queryKey: recallKeys.all }, current => current?.filter(item => item.id !== id));
      queryClient.setQueryData<KnowledgeItem[]>(knowledgeItemKeys.all, current => (current ?? []).filter(item => item.id !== id));
      await Promise.all([queryClient.invalidateQueries({ queryKey: knowledgeItemKeys.trash }), queryClient.invalidateQueries({ queryKey: recallKeys.all })]);
    },
  });
  const restoreMutation = useMutation({
    mutationFn: restoreKnowledgeItem,
    onSuccess: async ({ knowledgeItem }, id) => {
      closeItem(id);
      queryClient.setQueryData<KnowledgeItem[]>(knowledgeItemKeys.trash, current => (current ?? []).filter(item => item.id !== id));
      queryClient.setQueryData<KnowledgeItem[]>(knowledgeItemKeys.all, current => [knowledgeItem, ...(current ?? []).filter(item => item.id !== knowledgeItem.id)]);
      await Promise.all([queryClient.invalidateQueries({ queryKey: knowledgeItemKeys.all }), queryClient.invalidateQueries({ queryKey: knowledgeItemKeys.trash }), queryClient.invalidateQueries({ queryKey: recallKeys.all })]);
    },
  });
  const permanentlyDeleteMutation = useMutation({
    mutationFn: permanentlyDeleteKnowledgeItem,
    onSuccess: async (_, id) => {
      closeItem(id);
      await queryClient.invalidateQueries({ queryKey: knowledgeItemKeys.trash });
    },
  });
  function confirmPermanentDeletion(knowledgeItem: KnowledgeItem) { setPermanentDeletionTarget(knowledgeItem); }
  const recallQuery = useQuery({
    queryKey: recallKeys.search(searchQuery),
    queryFn: () => searchKnowledgeItems(searchQuery),
    enabled: Boolean(searchQuery) && !showTrash,
    retry: false,
  });
  const synthesisMutation = useMutation({
    mutationFn: askVault,
  });
  function askQuestion(question: string) {
    synthesisMutation.mutate({
      question,
      conversation: conversationTurns.slice(-6).map(turn => ({ question: turn.question, answer: turn.result.answer.slice(0, 4_000) })),
    }, {
      onSuccess: result => {
        setConversationTurns(turns => [...turns, { question, result }]);
        setSynthesisQuestion("");
      },
    });
  }
  async function showCapturedItem(knowledgeItem: KnowledgeItem) {
    await queryClient.cancelQueries({ queryKey: knowledgeItemKeys.all, exact: true });
    queryClient.setQueryData(knowledgeItemKeys.detail(knowledgeItem.id), knowledgeItem);
    queryClient.setQueryData<KnowledgeItem[]>(
      knowledgeItemKeys.all,
      (current) => [
        knowledgeItem,
        ...(current ?? []).filter((item) => item.id !== knowledgeItem.id),
      ],
    );
  }
  function clearSearch() { setSearchQuery(""); setSearchText(""); }
  async function revealDuplicate(knowledgeItem: KnowledgeItem) {
    await showCapturedItem(knowledgeItem);
    queryClient.setQueryData<KnowledgeItem[]>(knowledgeItemKeys.trash, current => current?.filter(item => item.id !== knowledgeItem.id));
    clearSearch();
    setShowTrash(false);
    setSourceFilter("all");
    setHighlightedItemId(knowledgeItem.id);
  }
  useEffect(() => {
    if (highlightedItemId === null) return;
    const card = document.getElementById(`knowledge-item-${highlightedItemId}`);
    card?.scrollIntoView?.({ block: "nearest", behavior: "instant" });
    card?.focus({ preventScroll: true });
    const timer = setTimeout(() => setHighlightedItemId(null), 4_000);
    return () => clearTimeout(timer);
  }, [highlightedItemId]);
  const boardQuery = showTrash ? trashQuery : searchQuery ? recallQuery : knowledgeItemsQuery;
  const visibleItems = (showTrash ? [...trashedKnowledgeItems].sort(newestFirst)
    : searchQuery ? recallQuery.data ?? [] : [...knowledgeItems].sort(newestFirst))
    .filter(item => showTrash || sourceFilter === "all" || (sourceFilter === "files" ? item.source.filename !== undefined : item.source.filename === undefined));
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-6 py-12 sm:px-10 lg:py-20">
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

      <UniversalCaptureArea onSaved={showCapturedItem} onDuplicate={revealDuplicate} disabled={showTrash}>
      <div className="mb-6 space-y-3">
        {!showTrash && <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1"><SearchForm query={searchText} onQueryChange={setSearchText} onSearch={setSearchQuery} onClear={clearSearch} isSearching={recallQuery.isFetching} /></div>
          <Button variant="outline" aria-expanded={filtersOpen} aria-controls="board-filters" onClick={() => setFiltersOpen(value => !value)}>Filter{sourceFilter !== "all" ? " · 1" : ""}</Button>
          <Button variant="ghost" render={<a href="#synthesis-heading" />} nativeButton={false}>Ask</Button>
        </div>}
        {!showTrash && filtersOpen && <div id="board-filters" className="space-y-3 rounded-xl border p-4">
          <p className="text-sm text-muted-foreground">{searchQuery ? "Filter these search results by how you saved them. Search returns the most relevant matches, not every saved item." : "Filter your saves by how you saved them."}</p>
          <RadioGroup aria-label="Saved as" value={sourceFilter} onValueChange={value => setSourceFilter(String(value))} className="flex flex-wrap gap-5">
            {[["all", "All saves"], ["links", "Links"], ["files", "Files"]].map(([value, label]) => <div key={value} className="flex items-center gap-2"><RadioGroupItem id={`filter-${value}`} value={value} /><Label htmlFor={`filter-${value}`}>{label}</Label></div>)}
          </RadioGroup>
        </div>}
      </div>
      <section aria-labelledby="knowledge-items-heading" className="space-y-5">
        <div>
          <div>
            <h2
              id="knowledge-items-heading"
              className="text-2xl font-semibold tracking-tight"
            >
              {showTrash ? "Trash" : searchQuery ? "Search results" : "Your saves"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {showTrash ? `${trashedKnowledgeItems.length} ${trashedKnowledgeItems.length === 1 ? "item" : "items"} retained in Trash.` : searchQuery ? `Matches for “${searchQuery}”, ordered by relevance` : `${knowledgeItems.length} ${knowledgeItems.length === 1 ? "save" : "saves"}`}
            </p>
            <Button variant="outline" className="mt-3" onClick={() => setShowTrash(value => !value)}>{showTrash ? "Back to saves" : "View Trash"}</Button>
          </div>
        </div>
        {boardQuery.isPending && (
          <Card role="status">
            <CardContent className="py-3 text-center text-muted-foreground">
              {searchQuery && !showTrash ? "Searching your saves…" : "Loading your saves…"}
            </CardContent>
          </Card>
        )}
        {(boardQuery.error && (showTrash || !searchQuery)) && (
          <Alert variant="destructive">
            <AlertDescription>
              {boardQuery.error?.message}
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
        {!showTrash && searchQuery && recallQuery.error && <Alert variant="destructive"><AlertDescription>Couldn’t search your saves. Please try again.</AlertDescription><Button variant="outline" onClick={() => void recallQuery.refetch()}>Try search again</Button></Alert>}
        {!boardQuery.isPending &&
          !boardQuery.error &&
          visibleItems.length === 0 && <Card><CardContent className="py-3 text-center text-muted-foreground">
            {showTrash ? "Trash is empty. Items you move here can be restored." : searchQuery ? "No matches here. Try another idea or clear your filters." : sourceFilter !== "all" ? "No saves match this filter." : "Your vault is empty. Use Add to save a link or file."}
          </CardContent></Card>}
        <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 xl:columns-4">
          {visibleItems.map(knowledgeItem => (
            <div id={`knowledge-item-${knowledgeItem.id}`} key={knowledgeItem.id} tabIndex={-1} aria-label={highlightedItemId === knowledgeItem.id ? "Already saved item" : undefined} className={`break-inside-avoid rounded-2xl ${highlightedItemId === knowledgeItem.id ? "ring-2 ring-primary ring-offset-4" : ""}`}>
              {"excerpts" in knowledgeItem ? <RecallResultCard result={knowledgeItem} onOpen={openItem} /> : <KnowledgeItemCard knowledgeItem={knowledgeItem} onOpen={openItem} />}
            </div>
          ))}
        </div>
      </section>
      </UniversalCaptureArea>
      {!showTrash && <section aria-labelledby="synthesis-heading" className="space-y-4">
        <div>
          <h2 id="synthesis-heading" className="text-2xl font-semibold tracking-tight">Ask your vault</h2>
          <p className="mt-1 text-sm text-muted-foreground">Answers use only matching captured evidence and cite the Knowledge Items that support them.</p>
          <p className="mt-1 text-sm text-muted-foreground">Questions, matching evidence, and current-session context are processed locally by Ollama. Original Files are not sent to the models.</p>
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
                  {turn.result.citations.map((citation, index) => <li key={`${citation.knowledgeItemId}-${citation.sourceSnapshotId ?? "context"}-${index}`} className="space-y-1 text-sm">
                    <Button variant="link" onClick={() => openItem(citation.knowledgeItemId)}>View {citation.title}</Button>
                    <blockquote className="border-l-2 pl-3 text-muted-foreground">{citation.excerpt}</blockquote>
                    <PdfPageReference pageNumber={citation.pageNumber} pageLabel={citation.pageLabel} openOriginalFile={citation.openOriginalFile} />
                    <PdfExtractionCoverage coverage={citation.extractionCoverage} />
                    {citation.origin === "personal-note" && <p className="text-muted-foreground">Based on your Personal Note.</p>}
                    {citation.origin === "selected-source-text" && <p className="text-muted-foreground">Based on selected Source text.</p>}
                    {citation.evidenceCoverage === "metadata-only" && <p className="text-muted-foreground">Based on source-provided metadata only.</p>}
                  </li>)}
                </ul>
              </section>}
            </CardContent>
          </Card>)}
        </section>}
      </section>}
      <KnowledgeItemDialog
        itemId={itemId}
        trashedItem={trashedKnowledgeItems.find(item => item.id === itemId)}
        onClose={closeItem}
        returnFocus={returnFocus}
        actionError={actionErrorForSelectedItem()}
        actions={{
          onRefresh: id => refreshMutation.mutate(id),
          onRetry: id => retryMutation.mutate(id),
          onTrash: id => trashMutation.mutate(id),
          onRestore: id => restoreMutation.mutate(id),
          onPermanentlyDelete: confirmPermanentDeletion,
          isRefreshing: refreshMutation.isPending && refreshMutation.variables === itemId,
          isRetrying: retryMutation.isPending && retryMutation.variables === itemId,
          isTrashing: trashMutation.isPending && trashMutation.variables === itemId,
          isRestoring: restoreMutation.isPending && restoreMutation.variables === itemId,
          isPermanentlyDeleting: permanentlyDeleteMutation.isPending && permanentlyDeleteMutation.variables === itemId,
        }}
      />
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

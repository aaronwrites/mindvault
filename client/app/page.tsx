"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useItemLifecycle } from "@/lib/use-item-lifecycle";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { UniversalCaptureArea } from "@/components/universal-capture-area";
import { KnowledgeItemDialog } from "@/components/knowledge-item-dialog";
import { useItemNavigation } from "@/lib/use-item-navigation";
import { KnowledgeItemCard, isItemProcessing, knowledgeItemTitle } from "@/components/knowledge-item-card";
import { originalFileTitle, sourcePreviewTitle } from "@/components/source-preview";
import { RecallResultCard } from "@/components/recall-result-card";
import { SearchForm } from "@/components/search-form";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { AskPanel, type ConversationTurn } from "@/components/ask-panel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { askVault, getKnowledgeItems, getTrashedKnowledgeItems, knowledgeItemKeys, recallKeys, refreshKnowledgeItem, retryKnowledgeItem, searchKnowledgeItems, } from "@/lib/api";
import type { KnowledgeItem } from "@/lib/types";

const lifecycleCopy = {
  trash: { pending: "Moving", verb: "move", suffix: " to Trash", retry: "removal" },
  restore: { pending: "Restoring", verb: "restore", suffix: "", retry: "restore" },
  delete: { pending: "Deleting", verb: "delete", suffix: "", retry: "deletion" },
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
  const [askOpen, setAskOpen] = useState(false);
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
    return [refreshMutation, retryMutation]
      .find(mutation => mutation.variables === itemId && mutation.error)
      ? "Couldn’t update this save. Please try again." : undefined;
  }
  const trashQuery = useQuery({ queryKey: knowledgeItemKeys.trash, queryFn: getTrashedKnowledgeItems, enabled: showTrash, refetchInterval: query => query.state.data?.some(item => item.lifecycleState === "pending-permanent-deletion") ? 2_000 : false });
  const trashedKnowledgeItems = trashQuery.data ?? [];
  const permanentDeletionLabel = permanentDeletionTarget
    ? permanentDeletionTarget.source.filename !== undefined
      ? originalFileTitle(permanentDeletionTarget.source.filename, permanentDeletionTarget.source.kind)
      : sourcePreviewTitle(permanentDeletionTarget.sourcePreview, permanentDeletionTarget.source.submittedUrl)
    : "this save";
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
  const synthesisMutation = useMutation({
    mutationFn: askVault,
  });
  const conversationVersion = useRef(0);
  const lifecycle = useItemLifecycle(id => {
    closeItem(id, document.getElementById("knowledge-items-heading"));
    conversationVersion.current += 1;
    setConversationTurns([]);
    synthesisMutation.reset();
  });
  function itemTitle(id: number) {
    const item = queryClient.getQueryData<KnowledgeItem>(knowledgeItemKeys.detail(id)) ?? knowledgeItems.find(item => item.id === id) ?? trashedKnowledgeItems.find(item => item.id === id);
    return item ? knowledgeItemTitle(item) : "this save";
  }
  function confirmPermanentDeletion(knowledgeItem: KnowledgeItem) { setPermanentDeletionTarget(knowledgeItem); }
  const recallQuery = useQuery({
    queryKey: recallKeys.search(searchQuery),
    queryFn: () => searchKnowledgeItems(searchQuery),
    enabled: Boolean(searchQuery) && !showTrash,
    retry: false,
  });
  function askQuestion(question: string) {
    if (synthesisMutation.isPending) return;
    const version = conversationVersion.current;
    synthesisMutation.mutate({
      question,
      conversation: conversationTurns.slice(-6).map(turn => ({ question: turn.question, answer: turn.result.answer.slice(0, 4_000) })),
    }, {
      onSuccess: result => {
        if (version !== conversationVersion.current) return;
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
    lifecycle.markActive(knowledgeItem.id);
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
    .filter(item => showTrash || !lifecycle.removedIds.has(item.id))
    .filter(item => showTrash || sourceFilter === "all" || (sourceFilter === "files" ? item.source.filename !== undefined : item.source.filename === undefined));
  const activeItemCount = knowledgeItems.filter(item => !lifecycle.removedIds.has(item.id)).length;
  const selectedNotice = lifecycle.notices.find(notice => notice.id === itemId);
  const selectedActionError = selectedNotice?.failed
    ? `Couldn’t ${lifecycleCopy[selectedNotice.operation].verb} this save${lifecycleCopy[selectedNotice.operation].suffix}. Please try again.`
    : actionErrorForSelectedItem();
  const itemDetails = (
    <KnowledgeItemDialog
        itemId={itemId !== null && lifecycle.removedIds.has(itemId) && !showTrash ? null : itemId}
        trashedItem={trashedKnowledgeItems.find(item => item.id === itemId)}
        onClose={closeItem}
        returnFocus={returnFocus}
        actionError={selectedActionError}
        actions={{
          onRefresh: id => refreshMutation.mutate(id),
          onRetry: id => retryMutation.mutate(id),
          onTrash: id => void lifecycle.run("trash", id, itemTitle(id)),
          onRestore: id => void lifecycle.run("restore", id, itemTitle(id)),
          onPermanentlyDelete: confirmPermanentDeletion,
          isRefreshing: refreshMutation.isPending && refreshMutation.variables === itemId,
          isRetrying: retryMutation.isPending && retryMutation.variables === itemId,
          isTrashing: lifecycle.isPending(itemId),
          isRestoring: lifecycle.isPending(itemId),
          isPermanentlyDeleting: lifecycle.isPending(itemId),
        }}
      />
  );
  return (
    <Dialog open={askOpen} onOpenChange={setAskOpen}>
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-6 py-12 sm:px-10 lg:py-20">
      <header className="space-y-3">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          MindVault
        </p>
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Save it now. Find it when it matters.
        </h1>
        <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
          Save useful information without interrupting your flow.
        </p>
      </header>

      <div aria-label="Save actions" className="space-y-2">
        {lifecycle.notices.map(notice => {
          const copy = lifecycleCopy[notice.operation];
          return <Alert key={notice.id} role={notice.failed ? "alert" : "status"} variant={notice.failed ? "destructive" : "default"}>
            <AlertDescription className="flex flex-wrap items-center gap-2">
              <span>{notice.pending ? `${copy.pending} “${notice.title}”…` : notice.failed ? `Couldn’t ${copy.verb} “${notice.title}”${copy.suffix}. Please try again.` : `Moved “${notice.title}” to Trash.`}</span>
              {!notice.pending && (notice.failed ? <Button variant="outline" onClick={() => {
                if (notice.operation === "delete") {
                  const item = trashedKnowledgeItems.find(item => item.id === notice.id);
                  if (item) confirmPermanentDeletion(item);
                } else void lifecycle.run(notice.operation, notice.id, notice.title);
              }}>Try {copy.retry} again for {notice.title}</Button> : <Button variant="outline" aria-label={`Undo removal of ${notice.title}`} onClick={() => void lifecycle.run("restore", notice.id, notice.title)}>Undo</Button>)}
            </AlertDescription>
          </Alert>;
        })}
      </div>
      <UniversalCaptureArea onSaved={showCapturedItem} onDuplicate={revealDuplicate} disabled={showTrash}>
      <div className="mb-6 space-y-3">
        {!showTrash && <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1"><SearchForm query={searchText} onQueryChange={setSearchText} onSearch={setSearchQuery} onClear={clearSearch} isSearching={recallQuery.isFetching} /></div>
          <Button variant="outline" aria-expanded={filtersOpen} aria-controls="board-filters" onClick={() => setFiltersOpen(value => !value)}>Filter{sourceFilter !== "all" ? " · 1" : ""}</Button>
          <DialogTrigger render={<Button variant="ghost" />}>Ask</DialogTrigger>
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
              tabIndex={-1}
              className="text-2xl font-semibold tracking-tight"
            >
              {showTrash ? "Trash" : searchQuery ? "Search results" : "Your saves"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {showTrash ? `${trashedKnowledgeItems.length} ${trashedKnowledgeItems.length === 1 ? "item" : "items"} retained in Trash.` : searchQuery ? `Matches for “${searchQuery}”, ordered by relevance` : `${activeItemCount} ${activeItemCount === 1 ? "save" : "saves"}`}
            </p>
            {showTrash ? <Button variant="outline" className="mt-3" onClick={() => setShowTrash(false)}>Back to saves</Button> : <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Board menu" />}><MoreHorizontal /></DropdownMenuTrigger>
              <DropdownMenuContent><DropdownMenuItem onClick={() => { closeItem(); setShowTrash(true); }}>View Trash</DropdownMenuItem></DropdownMenuContent>
            </DropdownMenu>}
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
              {showTrash ? "Couldn’t load Trash. Please try again." : "Couldn’t load your saves. Please try again."}
            </AlertDescription>
            <Button variant="outline" onClick={() => void boardQuery.refetch()}>{showTrash ? "Try loading Trash again" : "Try loading saves again"}</Button>
          </Alert>
        )}
        {!showTrash && searchQuery && recallQuery.error && <Alert variant="destructive"><AlertDescription>Couldn’t search your saves. Please try again.</AlertDescription><Button variant="outline" onClick={() => void recallQuery.refetch()}>Try search again</Button></Alert>}
        {!boardQuery.isPending &&
          !boardQuery.error &&
          visibleItems.length === 0 && <Card><CardContent className="py-3 text-center text-muted-foreground">
            {showTrash ? "Trash is empty. Items you move here can be restored." : searchQuery ? "No matches here. Try another idea or clear your filters." : sourceFilter !== "all" ? "No saves match this filter." : "Your vault is empty. Use Add to save a link or file."}
          </CardContent></Card>}
        <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 xl:columns-4">
          {visibleItems.map(knowledgeItem => (
            <div id={`knowledge-item-${knowledgeItem.id}`} key={knowledgeItem.id} tabIndex={-1} aria-label={highlightedItemId === knowledgeItem.id ? "Already saved item" : undefined} className={`break-inside-avoid rounded-2xl ${highlightedItemId === knowledgeItem.id ? "ring-2 ring-primary ring-offset-4" : ""}`}>
              {"excerpts" in knowledgeItem ? <RecallResultCard result={knowledgeItem} onOpen={openItem} onTrash={(id, title) => void lifecycle.run("trash", id, title)} /> : <KnowledgeItemCard knowledgeItem={knowledgeItem} onOpen={openItem} onTrash={(id, title) => void lifecycle.run("trash", id, title)} />}
            </div>
          ))}
        </div>
      </section>
      </UniversalCaptureArea>
      {askOpen ? <AskPanel
        question={synthesisQuestion}
        onQuestionChange={setSynthesisQuestion}
        onAsk={askQuestion}
        isAsking={synthesisMutation.isPending}
        error={synthesisMutation.error}
        conversationTurns={conversationTurns}
        openItem={openItem}
        titleForItem={(id, fallback) => {
          const item = queryClient.getQueryData<KnowledgeItem>(knowledgeItemKeys.detail(id)) ?? knowledgeItems.find(item => item.id === id);
          return item ? knowledgeItemTitle(item) : fallback;
        }}
      >{itemDetails}</AskPanel> : itemDetails}
      <AlertDialog open={permanentDeletionTarget !== null} onOpenChange={open => { if (!open) setPermanentDeletionTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete permanently?</AlertDialogTitle>
            <AlertDialogDescription>This permanently removes “{permanentDeletionLabel}” and its original content. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { if (permanentDeletionTarget) void lifecycle.run("delete", permanentDeletionTarget.id, knowledgeItemTitle(permanentDeletionTarget)); setPermanentDeletionTarget(null); }}>Delete permanently</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
    </Dialog>
  );
}

"use client";

import type { ReactNode } from "react";
import { DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { SynthesisForm } from "@/components/synthesis-form";
import { PdfPageReference } from "@/components/pdf-page-reference";
import { PdfExtractionCoverage } from "@/components/pdf-extraction-coverage";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { SynthesisResult } from "@/lib/types";

export type ConversationTurn = { question: string; result: SynthesisResult };

export function AskPanel({ question, onQuestionChange, onAsk, isAsking, error, conversationTurns, openItem, titleForItem, children }: {
  question: string;
  onQuestionChange: (question: string) => void;
  onAsk: (question: string) => void;
  isAsking: boolean;
  error: Error | null;
  conversationTurns: ConversationTurn[];
  openItem: (id: number) => void;
  titleForItem?: (id: number, fallback: string) => string;
  children: ReactNode;
}) {
  const errorMessage = error
    ? error.message === "Generation input exceeds the supported limit. Shorten your question."
      ? error.message
      : "Answer generation is temporarily unavailable. Please try again."
    : null;
  return <DialogContent className="inset-0 flex h-dvh max-h-dvh max-w-none translate-x-0 translate-y-0 flex-col rounded-none pt-14 motion-reduce:animate-none sm:left-auto sm:right-0 sm:w-[min(36rem,100%)] sm:max-w-none">
    <div className="shrink-0 space-y-2">
      <DialogTitle className="text-2xl">Ask your vault</DialogTitle>
      <DialogDescription>Ask about all your saves. Answers use only matching saved evidence, with links and excerpts to show where they came from.</DialogDescription>
      <p className="text-xs text-muted-foreground">Questions, matching evidence, and current-session context are processed locally by Ollama. Original files are not sent to the models.</p>
      <p className="text-xs text-muted-foreground">This conversation lasts for this session.</p>
    </div>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain" aria-busy={isAsking}>
      {isAsking && <Card role="status"><CardContent className="py-3 text-center text-muted-foreground">Finding relevant saved information…</CardContent></Card>}
      {errorMessage && <Alert variant="destructive"><AlertDescription>{errorMessage}</AlertDescription></Alert>}
      {conversationTurns.length > 0 && <section aria-label="Current conversation" className="space-y-4">
        {conversationTurns.map((turn, index) => <Card key={`${turn.question}-${index}`}>
          <CardContent className="space-y-4 py-5">
            <p className="text-sm font-medium">You asked: {turn.question}</p>
            <p className="whitespace-pre-wrap break-words">{turn.result.answer}</p>
            {turn.result.insufficientEvidence ? <p className="text-sm text-muted-foreground">There isn’t enough evidence in your saves to answer this. Save more relevant content, then ask again.</p> : <section aria-label="Supporting saves" className="space-y-3">
              <p className="text-sm font-medium">Supporting saves</p>
              <ul className="space-y-3">
                {turn.result.citations.map((citation, index) => <li key={`${citation.knowledgeItemId}-${citation.sourceSnapshotId ?? "context"}-${index}`} className="space-y-1 break-words text-sm">
                  <Button variant="link" className="h-auto max-w-full justify-start whitespace-normal text-left" onClick={() => openItem(citation.knowledgeItemId)}>View {titleForItem?.(citation.knowledgeItemId, citation.title) ?? citation.title}</Button>
                  <blockquote className="border-l-2 pl-3 text-muted-foreground">{citation.excerpt}</blockquote>
                  <PdfPageReference pageNumber={citation.pageNumber} pageLabel={citation.pageLabel} openOriginalFile={citation.openOriginalFile} />
                  <PdfExtractionCoverage coverage={citation.extractionCoverage} />
                  {citation.origin === "personal-note" && <p className="text-muted-foreground">Based on your personal note.</p>}
                  {citation.origin === "selected-source-text" && <p className="text-muted-foreground">Based on selected source text.</p>}
                  {citation.evidenceCoverage === "metadata-only" && <p className="text-muted-foreground">Based only on the website’s description, not the full content.</p>}
                </li>)}
              </ul>
            </section>}
          </CardContent>
        </Card>)}
      </section>}
    </div>
    <div className="shrink-0">
      <SynthesisForm onAsk={onAsk} isAsking={isAsking} question={question} onQuestionChange={onQuestionChange} />
    </div>
    {children}
  </DialogContent>;
}

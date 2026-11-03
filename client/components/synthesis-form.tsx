"use client";

import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function SynthesisForm({ onAsk, isAsking, question, onQuestionChange }: {
  onAsk: (question: string) => void;
  isAsking: boolean;
  question: string;
  onQuestionChange: (question: string) => void;
}) {

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuestion = question.trim();
    if (trimmedQuestion && !isAsking) onAsk(trimmedQuestion);
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Textarea
        aria-label="Ask a question about your captured knowledge"
        maxLength={2_000}
        disabled={isAsking}
        value={question}
        onChange={event => onQuestionChange(event.target.value)}
        placeholder="Ask about something you’ve saved"
      />
      <Button type="submit" disabled={isAsking || !question.trim()}>
        {isAsking ? "Finding evidence…" : "Ask your vault"}
      </Button>
    </form>
  );
}

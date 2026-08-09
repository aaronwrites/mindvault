"use client";

import { FormEvent, useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Resource } from "@/lib/types";

type SearchFormProps = {
  apiUrl: string;
  onResults: (query: string, results: Resource[]) => void;
  onClear: () => void;
  onError: (message: string) => void;
};

export function SearchForm({ apiUrl, onResults, onClear, onError }: SearchFormProps) {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;

    setIsSearching(true);
    try {
      const response = await fetch(`${apiUrl}/search?q=${encodeURIComponent(trimmedQuery)}`);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(typeof body?.error === "string" ? body.error : "Could not search your resources.");
      }
      onResults(trimmedQuery, await response.json());
    } catch (searchError) {
      onError(searchError instanceof Error ? searchError.message : "Could not search your resources.");
    } finally {
      setIsSearching(false);
    }
  }

  function clearSearch() {
    setQuery("");
    onClear();
  }

  return (
    <form onSubmit={handleSubmit} role="search" className="flex gap-2">
      <Input
        aria-label="Search resources"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search by meaning, e.g. container orchestration"
        className="h-10"
      />
      {query && (
        <Button type="button" variant="outline" size="icon" onClick={clearSearch} aria-label="Clear search">
          <X />
        </Button>
      )}
      <Button type="submit" disabled={isSearching || !query.trim()}>
        <Search />
        {isSearching ? "Searching…" : "Search"}
      </Button>
    </form>
  );
}

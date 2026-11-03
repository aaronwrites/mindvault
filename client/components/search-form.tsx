"use client";

import { FormEvent } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SearchFormProps = {
  query: string;
  onQueryChange: (query: string) => void;
  onSearch: (query: string) => void;
  onClear: () => void;
  isSearching: boolean;
};

export function SearchForm({ query, onQueryChange, onSearch, onClear, isSearching }: SearchFormProps) {

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;
    onSearch(trimmedQuery);
  }

  function clearSearch() {
    onQueryChange("");
    onClear();
  }

  return (
    <form onSubmit={handleSubmit} role="search" className="space-y-1.5" aria-busy={isSearching}>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Input
            aria-label="Search your saves"
            value={query}
            onChange={(event) => { onQueryChange(event.target.value); if (!event.target.value.trim()) onClear(); }}
            placeholder="Search by meaning"
            className="h-11 pr-11" maxLength={500}
          />
          {query && (
            <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0 size-11" onClick={clearSearch} aria-label="Clear search">
              <X />
            </Button>
          )}
        </div>
        <Button type="submit" className="h-11 w-11 shrink-0 sm:w-32" disabled={!query.trim()}>
          <Search />
          <span className="sr-only sm:not-sr-only">{isSearching ? "Searching…" : "Search"}</span>
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">Try “container orchestration”.</p>
    </form>
  );
}

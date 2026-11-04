"use client";

import { FormEvent } from "react";
import { Search, X, LoaderCircle } from "lucide-react";
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
    <form onSubmit={handleSubmit} role="search" className="collection-search" aria-busy={isSearching}>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute top-5 left-4 z-10 size-4 text-muted-foreground" /><Input
            aria-label="Search your saves"
            value={query}
            onChange={(event) => { onQueryChange(event.target.value); if (!event.target.value.trim()) onClear(); }}
            placeholder="What do you remember?"
            className="h-14 pl-12 pr-12" maxLength={500}
          />
          {query && (
            <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1.5 size-11" onClick={clearSearch} aria-label="Clear search">
              <X />
            </Button>
          )}
        </div>
        <Button type="submit" className="h-14 w-14 shrink-0 sm:w-28" disabled={!query.trim()}>
          {isSearching ? <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Search aria-hidden="true" />}
          <span className="sr-only sm:not-sr-only">{isSearching ? "Searching…" : "Search"}</span>
        </Button>
      </div>
    </form>
  );
}

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
    <form onSubmit={handleSubmit} role="search" className="flex gap-2" aria-busy={isSearching}>
      <Input
        aria-label="Search your saves"
        value={query}
        onChange={(event) => { onQueryChange(event.target.value); if (!event.target.value.trim()) onClear(); }}
        placeholder="Search by meaning, e.g. container orchestration"
        className="h-10" maxLength={500}
      />
      {query && (
        <Button type="button" variant="outline" size="icon" onClick={clearSearch} aria-label="Clear search">
          <X />
        </Button>
      )}
      <Button type="submit" disabled={!query.trim()}>
        <Search />
        {isSearching ? "Searching…" : "Search"}
      </Button>
    </form>
  );
}

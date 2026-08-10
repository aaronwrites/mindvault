"use client";

import { FormEvent, useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SearchFormProps = {
  onSearch: (query: string) => void;
  onClear: () => void;
  isSearching: boolean;
};

export function SearchForm({ onSearch, onClear, isSearching }: SearchFormProps) {
  const [query, setQuery] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;
    onSearch(trimmedQuery);
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

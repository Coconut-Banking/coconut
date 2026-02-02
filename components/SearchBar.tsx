"use client";

import { useState } from "react";

interface SearchBarProps {
  onSearch: (q: string) => void;
  placeholder?: string;
}

export function SearchBar({ onSearch, placeholder = "Search transactions (e.g. coffee, subscriptions, dining)..." }: SearchBarProps) {
  const [q, setQ] = useState("");
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(q);
      }}
    >
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-[var(--card)] border border-[var(--border)] rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
      />
      <button
        type="submit"
        className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg text-sm font-medium hover:opacity-90"
      >
        Search
      </button>
    </form>
  );
}

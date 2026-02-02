"use client";

import { useState, useEffect } from "react";
import { TransactionList } from "@/components/TransactionList";
import { SubscriptionCards } from "@/components/SubscriptionCards";
import { SearchBar } from "@/components/SearchBar";
import { ChatPanel } from "@/components/ChatPanel";
import type { Transaction, Subscription } from "@/lib/types";

export default function Home() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Transaction[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/transactions").then((r) => r.json()),
      fetch("/api/subscriptions").then((r) => r.json()).catch(() => []),
    ]).then(([tx, sub]) => {
      setTransactions(tx);
      setSubscriptions(Array.isArray(sub) ? sub : []);
      setLoading(false);
    });
  }, []);

  async function handleSearch(q: string) {
    setSearchQuery(q);
    if (!q.trim()) {
      setSearchResults(null);
      return;
    }
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=20`);
    const data = await res.json();
    setSearchResults(data);
  }

  const displayTx = searchResults !== null ? searchResults : transactions;

  return (
    <div className="min-h-screen max-w-4xl mx-auto px-4 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-white">Coconut</h1>
        <p className="text-[var(--muted)] text-sm mt-1">
          Personal finance with semantic search and AI
        </p>
      </header>

      <section className="mb-8">
        <h2 className="text-sm font-medium text-[var(--muted)] mb-2">Subscriptions</h2>
        {loading ? (
          <p className="text-sm text-[var(--muted)]">Loading...</p>
        ) : (
          <SubscriptionCards subscriptions={subscriptions} />
        )}
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium text-[var(--muted)] mb-2">Search transactions</h2>
        <SearchBar onSearch={handleSearch} />
        {searchQuery && (
          <p className="text-xs text-[var(--muted)] mt-1">
            {searchResults !== null
              ? `${searchResults.length} result(s) for “${searchQuery}”`
              : "Search by merchant, category, or description"}
          </p>
        )}
      </section>

      <section className="mb-8">
        <h2 className="text-sm font-medium text-[var(--muted)] mb-2">Transactions</h2>
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
          {loading ? (
            <p className="text-sm text-[var(--muted)]">Loading...</p>
          ) : displayTx.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No transactions to show.</p>
          ) : (
            <TransactionList transactions={displayTx} />
          )}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-[var(--muted)] mb-2">Ask about your data</h2>
        <ChatPanel />
      </section>
    </div>
  );
}

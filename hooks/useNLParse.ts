"use client";

import { useState, useEffect, useRef } from "react";
import { parseQuery, type QueryFilters } from "@/lib/nl-query";

const DEBOUNCE_MS = 400;

export function useNLParse(query: string): { filters: QueryFilters; loading: boolean } {
  const [filters, setFilters] = useState<QueryFilters>(() => parseQuery(query));
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const abortRef = useRef<AbortController>();

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setFilters({ keywords: [] });
      setLoading(false);
      return;
    }

    setFilters(parseQuery(q));

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(`/api/nl-parse?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        const data = await res.json();
        if (data?.filters && !controller.signal.aborted) {
          console.log("[useNLParse] query:", q, "-> filters:", data.filters);
          setFilters(data.filters);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.warn("[useNLParse] fetch error:", err);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, [query]);

  return { filters, loading };
}

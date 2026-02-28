"use client";

import { useState, useEffect, useRef } from "react";
import { parseQuery, type QueryFilters } from "@/lib/nl-query";

const DEBOUNCE_MS = 400;

export function useNLParse(query: string): { filters: QueryFilters; loading: boolean } {
  const [filters, setFilters] = useState<QueryFilters>(() => parseQuery(query));
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setFilters({ keywords: [] });
      setLoading(false);
      return;
    }

    setFilters(parseQuery(q));

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/nl-parse?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (data?.filters) {
          console.log("[useNLParse] query:", q, "-> filters:", data.filters);
          setFilters(data.filters);
        }
      } catch (err) {
        console.warn("[useNLParse] fetch error:", err);
        // Keep regex filters on error
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  return { filters, loading };
}

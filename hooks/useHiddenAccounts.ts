"use client";

import { useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "coconut_hidden_account_ids";

function readHidden(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function useHiddenAccounts() {
  const [hidden, setHidden] = useState<string[]>([]);

  useEffect(() => {
    setHidden(readHidden());
  }, []);

  const hide = useCallback((id: string) => {
    setHidden((prev) => {
      const next = [...prev, id].filter((v, i, a) => a.indexOf(v) === i);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const unhide = useCallback((id: string) => {
    setHidden((prev) => {
      const next = prev.filter((x) => x !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const isHidden = useCallback(
    (id: string) => hidden.includes(id),
    [hidden]
  );

  return { hidden, hide, unhide, isHidden };
}

"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useGroupListen } from "./useGroupListen";

export interface Group {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  memberCount?: number;
}

export interface GroupMember {
  id: string;
  user_id: string | null;
  email: string | null;
  display_name: string;
  venmo_username?: string | null;
  cashapp_cashtag?: string | null;
  paypal_username?: string | null;
}

export interface GroupDetail extends Group {
  isOwner?: boolean;
  image_url?: string | null;
  members: GroupMember[];
  activity: Array<{
    id: string;
    merchant: string;
    amount: number;
    paidBy: string;
    paidByDisplayName?: string;
    splitCount: number;
    createdAt: string;
    _optimistic?: true;
  }>;
  balances: Array<{ memberId: string; paid: number; owed: number; total: number }>;
  suggestions: Array<{
    fromMemberId: string;
    toMemberId: string;
    amount: number;
    fromMember?: GroupMember;
    toMember?: GroupMember;
  }>;
  totalSpend: number;
}

export function useGroups() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await fetch("/api/groups");
      if (res.ok) {
        const data = await res.json();
        setGroups(Array.isArray(data) ? data : []);
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Failed to load groups");
      }
    } catch {
      setError("Failed to load groups");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  return { groups, loading, error, refetch: fetchGroups };
}

export function useGroupDetail(id: string | null) {
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [pendingActivity, setPendingActivity] = useState<GroupDetail["activity"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = useCallback(async (silent = false, isCancelled?: () => boolean) => {
    if (!id) {
      setDetail(null);
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    try {
      setError(null);
      const res = await fetch(`/api/groups/${id}`);
      if (isCancelled?.()) return;
      if (res.ok) {
        const data = await res.json();
        if (!isCancelled?.()) setDetail(data && typeof data === "object" ? {
          ...data,
          members: Array.isArray(data.members) ? data.members : [],
          activity: Array.isArray(data.activity) ? data.activity : [],
          suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
        } : null);
      } else {
        const body = await res.json().catch(() => ({}));
        if (!isCancelled?.()) { setError(body.error ?? "Failed to load group"); setDetail(null); }
      }
    } catch {
      if (!isCancelled?.()) { setError("Failed to load group"); setDetail(null); }
    } finally {
      if (!silent && !isCancelled?.()) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    fetchDetail(false, () => cancelled);
    return () => { cancelled = true; };
  }, [fetchDetail]);

  useGroupListen(id, () => fetchDetail(true));

  // Optimistic expense creation — show new expense immediately while API call is in flight.
  // Balances are NOT optimistically updated (requires server-side math); only activity list.
  const addOptimisticExpense = useCallback(
    (item: Omit<GroupDetail["activity"][0], "id" | "_optimistic">) => {
      const tempId = `optimistic-${Date.now()}`;
      setPendingActivity((prev) => [{ ...item, id: tempId, _optimistic: true }, ...prev]);
      return tempId;
    },
    []
  );

  const confirmOptimisticExpense = useCallback(
    (tempId: string) => {
      setPendingActivity((prev) => prev.filter((e) => e.id !== tempId));
      fetchDetail(true); // silent refetch to get authoritative balances
    },
    [fetchDetail]
  );

  const rollbackOptimisticExpense = useCallback((tempId: string) => {
    setPendingActivity((prev) => prev.filter((e) => e.id !== tempId));
  }, []);

  const mergedDetail = useMemo<GroupDetail | null>(() => {
    if (!detail) return null;
    if (pendingActivity.length === 0) return detail;
    return { ...detail, activity: [...pendingActivity, ...detail.activity] };
  }, [detail, pendingActivity]);

  return {
    detail: mergedDetail,
    loading,
    error,
    refetch: fetchDetail,
    addOptimisticExpense,
    confirmOptimisticExpense,
    rollbackOptimisticExpense,
  };
}

export interface GroupSummary {
  id: string;
  name: string;
  memberCount: number;
  myBalance: number;
  lastActivityAt: string;
  imageUrl?: string | null;
}

export interface FriendBalance {
  key: string;
  displayName: string;
  balance: number;
}

export interface PersonDetail {
  displayName: string;
  balance: number;
  activity: Array<{
    id: string;
    merchant: string;
    amount: number;
    groupName: string;
    paidByMe: boolean;
    paidByThem: boolean;
    myShare: number;
    theirShare: number;
    effectOnBalance: number;
    createdAt: string;
  }>;
  email: string | null;
  key: string;
  settlements?: Array<{ groupId: string; fromMemberId: string; toMemberId: string; amount: number }>;
}

export interface GroupsSummary {
  groups: GroupSummary[];
  friends: FriendBalance[];
  totalOwedToMe: number;
  totalIOwe: number;
  netBalance: number;
}

export function useGroupsSummary() {
  const [summary, setSummary] = useState<GroupsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    try {
      setError(null);
      const res = await fetch("/api/groups/summary");
        if (res.ok) {
        const data = await res.json();
        setSummary(data && typeof data === "object" ? {
          ...data,
          groups: Array.isArray(data.groups) ? data.groups : [],
          friends: Array.isArray(data.friends) ? data.friends : [],
        } : null);
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Failed to load summary");
        setSummary(null);
      }
    } catch {
      setError("Failed to load summary");
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  return { summary, loading, error, refetch: fetchSummary };
}

export function usePersonDetail(key: string | null) {
  const [detail, setDetail] = useState<PersonDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = useCallback(async (silent = false) => {
    if (!key) {
      setDetail(null);
      setError(null);
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`/api/groups/person?key=${encodeURIComponent(key)}`);
      if (res.ok) {
        const data = await res.json();
        setError(null);
        setDetail(data && typeof data === "object" ? {
          ...data,
          activity: Array.isArray(data.activity) ? data.activity : [],
          settlements: Array.isArray(data.settlements) ? data.settlements : [],
        } : null);
      } else {
        setDetail(null);
        setError("Failed to load person details");
      }
    } catch {
      setDetail(null);
      setError("Failed to load person details");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const fetchDetailRef = useRef(fetchDetail);
  fetchDetailRef.current = fetchDetail;

  // Refetch on tab visibility restore or window focus instead of polling every 30s
  useEffect(() => {
    if (!key) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchDetailRef.current(true);
    };
    const onFocus = () => fetchDetailRef.current(true);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [key]);

  return { detail, loading, error, refetch: fetchDetail };
}

export interface RecentActivityItem {
  id: string;
  who: string;
  action: string;
  what: string;
  in: string;
  direction: "get_back" | "owe" | "settled";
  amount: number;
  time: string;
}

export function useRecentActivity(enabled = true) {
  const [activity, setActivity] = useState<RecentActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchActivity = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/groups/recent-activity");
      if (res.ok) {
        const data = await res.json();
        setActivity(Array.isArray(data.activity) ? data.activity : []);
      } else setActivity([]);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  return { activity, loading, refetch: fetchActivity };
}

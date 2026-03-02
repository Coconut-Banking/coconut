"use client";

import { useState, useEffect, useCallback } from "react";
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
}

export interface GroupDetail extends Group {
  isOwner?: boolean;
  members: GroupMember[];
  activity: Array<{
    id: string;
    merchant: string;
    amount: number;
    paidBy: string;
    splitCount: number;
    createdAt: string;
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

  const fetchGroups = useCallback(async () => {
    try {
      const res = await fetch("/api/groups");
      if (res.ok) {
        const data = await res.json();
        setGroups(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  return { groups, loading, refetch: fetchGroups };
}

export function useGroupDetail(id: string | null) {
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDetail = useCallback(async (silent = false) => {
    if (!id) {
      setDetail(null);
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`/api/groups/${id}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setDetail(data);
      } else setDetail(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  useGroupListen(id, () => fetchDetail(true));

  return { detail, loading, refetch: fetchDetail };
}

export interface GroupSummary {
  id: string;
  name: string;
  memberCount: number;
  myBalance: number;
  lastActivityAt: string;
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

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/groups/summary", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setSummary(data);
      } else setSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  return { summary, loading, refetch: fetchSummary };
}

const PERSON_POLL_MS = 30000; // Person view spans multiple groups — poll every 30s

export function usePersonDetail(key: string | null) {
  const [detail, setDetail] = useState<PersonDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDetail = useCallback(async (silent = false) => {
    if (!key) {
      setDetail(null);
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`/api/groups/person?key=${encodeURIComponent(key)}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setDetail(data);
      } else setDetail(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  useEffect(() => {
    if (!key) return;
    const interval = setInterval(() => fetchDetail(true), PERSON_POLL_MS);
    return () => clearInterval(interval);
  }, [key, fetchDetail]);

  return { detail, loading, refetch: fetchDetail };
}

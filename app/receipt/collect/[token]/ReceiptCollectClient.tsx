"use client";

import { useCallback, useEffect, useState } from "react";

type Item = { id: string; name: string; total_price: number };
type Participant = { member_id: string; display_name: string; status: string };

export function ReceiptCollectClient({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [merchantName, setMerchantName] = useState("");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/receipt/collect/${encodeURIComponent(token)}`);
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Link invalid");
          return;
        }
        setMerchantName(data.merchantName ?? "Receipt");
        setParticipants(data.participants ?? []);
        setItems(data.items ?? []);
      } catch {
        setError("Could not load bill");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const toggleItem = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = useCallback(async () => {
    if (!memberId || selected.size === 0) return;
    setSubmitting(true);
    const name = participants.find((p) => p.member_id === memberId)?.display_name ?? "Guest";
    const assignments = [...selected].map((itemId) => ({
      itemId,
      assignees: [{ name, memberId }],
    }));
    try {
      const res = await fetch(`/api/receipt/collect/${encodeURIComponent(token)}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, assignments }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Submit failed");
        return;
      }
      setDone(true);
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }, [memberId, selected, participants, token]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    );
  }

  if (error && !memberId) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-bold text-[#1e2021]">You&apos;re done</h1>
        <p className="mt-2 text-sm text-gray-500">
          We&apos;ll notify you when it&apos;s time to pay your share.
        </p>
      </div>
    );
  }

  const joinAsGuest = async () => {
    const name = guestName.trim();
    if (!name) return;
    setJoining(true);
    try {
      const res = await fetch(`/api/receipt/collect/${encodeURIComponent(token)}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not join");
        return;
      }
      setMemberId(data.memberId);
      setParticipants((prev) => [
        ...prev,
        { member_id: data.memberId, display_name: name, status: "invited" },
      ]);
    } catch {
      setError("Network error");
    } finally {
      setJoining(false);
    }
  };

  if (!memberId) {
    const listed = participants.filter(
      (p) => p.display_name.toLowerCase() !== "you" || participants.length > 1,
    );
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-[#1e2021]">{merchantName}</h1>
        <p className="mt-1 text-sm text-gray-500">
          {listed.length > 0 ? "Pick your name" : "Enter your name to join"}
        </p>
        {listed.length > 0 ? (
          <div className="mt-6 grid grid-cols-2 gap-2">
            {listed.map((p) => (
              <button
                key={p.member_id}
                type="button"
                disabled={p.status === "submitted"}
                onClick={() => setMemberId(p.member_id)}
                className="rounded-xl border border-gray-200 bg-[#F5F3F2] px-3 py-3 text-sm font-semibold text-[#1e2021] disabled:opacity-40"
              >
                {p.display_name}
                {p.status === "submitted" ? " ✓" : ""}
              </button>
            ))}
          </div>
        ) : null}
        <div className="mt-6 space-y-3 rounded-xl border border-gray-200 bg-[#F5F3F2] p-4">
          <input
            type="text"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            placeholder="Your name"
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-[#1e2021]"
            onKeyDown={(e) => {
              if (e.key === "Enter") void joinAsGuest();
            }}
          />
          <button
            type="button"
            disabled={joining || !guestName.trim()}
            onClick={() => void joinAsGuest()}
            className="w-full rounded-xl bg-[#1e2021] py-2.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            {joining ? "Joining…" : "Continue"}
          </button>
        </div>
      </div>
    );
  }

  const myName = participants.find((p) => p.member_id === memberId)?.display_name;

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-bold text-[#1e2021]">{merchantName}</h1>
      <p className="mt-1 text-sm text-gray-500">Tap what you had, {myName}</p>
      <ul className="mt-4 space-y-2">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => toggleItem(item.id)}
              className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm ${
                selected.has(item.id)
                  ? "border-[#1e2021] bg-[#1e2021]/5"
                  : "border-gray-200"
              }`}
            >
              <span className="font-medium text-[#1e2021]">{item.name}</span>
              <span className="text-gray-500">${Number(item.total_price).toFixed(2)}</span>
            </button>
          </li>
        ))}
      </ul>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      <button
        type="button"
        disabled={selected.size === 0 || submitting}
        onClick={() => void submit()}
        className="mt-6 w-full rounded-xl bg-[#1e2021] py-3 text-sm font-semibold text-white disabled:opacity-40"
      >
        {submitting ? "Submitting…" : "Submit my items"}
      </button>
    </div>
  );
}

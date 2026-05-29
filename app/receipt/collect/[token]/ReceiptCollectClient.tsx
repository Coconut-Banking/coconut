"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { InlineBillPay } from "@/components/pay/InlineBillPay";
import { tokenFromPayUrl } from "@/lib/pay-url-token";

type Item = { id: string; name: string; total_price: number };
type Participant = { member_id: string; display_name: string; status: string };
type Share = {
  memberId: string;
  displayName: string;
  amount: number;
  currency: string;
  status: string;
  payUrl: string | null;
};

export function ReceiptCollectClient({ token }: { token: string }) {
  const searchParams = useSearchParams();
  const urlPaid = searchParams.get("paid") === "1" || searchParams.get("redirect_status") === "succeeded";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"collect" | "pay">("collect");
  const [merchantName, setMerchantName] = useState("");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [shares, setShares] = useState<Share[]>([]);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [nameSearch, setNameSearch] = useState("");
  const [joining, setJoining] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/receipt/collect/${encodeURIComponent(token)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Link invalid");
        return;
      }
      setMerchantName(data.merchantName ?? "Receipt");
      setParticipants(data.participants ?? []);
      setPhase(data.phase === "pay" ? "pay" : "collect");
      if (data.phase === "pay") {
        setShares(data.shares ?? []);
        setDone(false);
      } else {
        setItems(data.items ?? []);
      }
      setError(null);
    } catch {
      setError("Could not load bill");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, [load]);

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
      void load();
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }, [memberId, selected, participants, token, load]);

  const listed = useMemo(() => {
    const base = participants.filter(
      (p) => p.display_name.toLowerCase() !== "you" || participants.length > 1,
    );
    const q = nameSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter((p) => p.display_name.toLowerCase().includes(q));
  }, [participants, nameSearch]);

  const filteredShares = useMemo(() => {
    const q = nameSearch.trim().toLowerCase();
    if (!q) return shares;
    return shares.filter((s) => s.displayName.toLowerCase().includes(q));
  }, [shares, nameSearch]);

  const myShare = memberId
    ? shares.find((s) => s.memberId === memberId)
    : shares.find(
        (s) =>
          nameSearch.trim() &&
          s.displayName.toLowerCase() === nameSearch.trim().toLowerCase(),
      );

  const myPayToken = myShare?.payUrl ? tokenFromPayUrl(myShare.payUrl) : null;

  if (loading) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    );
  }

  if (error && !memberId && phase === "collect") {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  if (phase === "pay") {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-[#1e2021]">{merchantName}</h1>
        <p className="mt-1 text-sm text-gray-500">Find your name to pay your share</p>
        <input
          type="search"
          value={nameSearch}
          onChange={(e) => setNameSearch(e.target.value)}
          placeholder="Search your name"
          className="mt-4 w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-[#1e2021]"
        />
        {myShare ? (
          <div className="mt-4 rounded-xl border border-[#E3DBD8] bg-[#F5F3F2] p-4">
            <p className="text-sm font-semibold text-[#1e2021]">{myShare.displayName}</p>
            <p className="mt-1 text-2xl font-bold text-[#1e2021]">
              ${myShare.amount.toFixed(2)}
            </p>
            {myShare.status === "paid" || urlPaid ? (
              <p className="mt-2 text-sm font-medium text-green-700">Paid ✓</p>
            ) : myShare.payUrl ? (
              <div className="mt-4">
                {myPayToken ? (
                  <InlineBillPay token={myPayToken} onPaid={() => void load()} />
                ) : (
                  <p className="text-sm text-gray-500">Payment link not ready — refresh shortly.</p>
                )}
              </div>
            ) : (
              <p className="mt-2 text-sm text-gray-500">Payment link not ready — refresh shortly.</p>
            )}
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {filteredShares.map((s) => (
              <li key={s.memberId}>
                <button
                  type="button"
                  onClick={() => {
                    setNameSearch(s.displayName);
                    setMemberId(s.memberId);
                  }}
                  className="flex w-full items-center justify-between rounded-xl border border-gray-200 px-4 py-3 text-left text-sm hover:border-[#1e2021]"
                >
                  <span className="font-medium text-[#1e2021]">{s.displayName}</span>
                  <span className="text-gray-600">
                    ${s.amount.toFixed(2)}
                    {s.status === "paid" ? " · Paid" : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={() => void load()}
          className="mt-4 w-full rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-[#1e2021]"
        >
          Refresh
        </button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-bold text-[#1e2021]">You&apos;re done</h1>
        <p className="mt-2 text-sm text-gray-500">
          Your items are saved. When the host finishes the bill, come back to this same link to pay.
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-4 w-full rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-[#1e2021]"
        >
          Refresh for payment
        </button>
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
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-[#1e2021]">{merchantName}</h1>
        <p className="mt-1 text-sm text-gray-500">Search or pick your name, then tap your items</p>
        <input
          type="search"
          value={nameSearch}
          onChange={(e) => setNameSearch(e.target.value)}
          placeholder="Search your name"
          className="mt-4 w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-[#1e2021]"
        />
        {listed.length > 0 ? (
          <div className="mt-4 grid grid-cols-2 gap-2">
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
          <p className="text-xs text-gray-500">Or type your name if you don&apos;t see it</p>
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

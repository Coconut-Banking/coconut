"use client";

import {
  Users,
  Plus,
  ArrowLeft,
  UserPlus,
  Wallet,
  CheckCircle2,
  Send,
  Mail,
  Trash2,
} from "lucide-react";
import { motion } from "motion/react";
import { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { useGroupsSummary, useGroupDetail, usePersonDetail } from "@/hooks/useGroups";
import { useDemoMode } from "@/components/AppGate";
import { useTransactions } from "@/hooks/useTransactions";

const MEMBER_COLORS = ["#3D8E62", "#4A6CF7", "#E8507A", "#F59E0B", "#10A37F", "#FF5A5F"];

function MemberAvatar({ name, color }: { name: string; color: string }) {
  return (
    <div
      className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-bold shrink-0"
      style={{ backgroundColor: color }}
    >
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

export default function SharedPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedPersonKey, setSelectedPersonKey] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [addMemberError, setAddMemberError] = useState<string | null>(null);
  const { user } = useUser();
  const { linked } = useTransactions();
  const { summary, loading, refetch: refetchSummary } = useGroupsSummary();
  const { detail, loading: detailLoading, refetch: refetchDetail } = useGroupDetail(selectedId);
  const { detail: personDetail, loading: personDetailLoading, refetch: refetchPersonDetail } = usePersonDetail(selectedPersonKey);
  const isDemo = useDemoMode();
  const showRealUI = linked && !isDemo;

  // Refetch summary when returning to main list so balances stay in sync
  useEffect(() => {
    if (!selectedId && !selectedPersonKey && showRealUI) refetchSummary();
  }, [selectedId, selectedPersonKey, showRealUI, refetchSummary]);

  const createGroup = async () => {
    if (!newGroupName.trim()) return;
    setCreateError(null);
    setCreating(true);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newGroupName.trim(), ownerDisplayName: "You" }),
      });
      const data = await res.json();
      if (res.ok) {
        setNewGroupName("");
        setShowCreate(false);
        refetchSummary();
        setSelectedId(data.id);
      } else {
        setCreateError(data.error ?? `Failed (${res.status})`);
      }
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setCreating(false);
    }
  };

  const addMember = async () => {
    if (!selectedId || !newMemberName.trim()) return;
    setAddMemberError(null);
    const res = await fetch(`/api/groups/${selectedId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: newMemberName.trim(),
        email: newMemberEmail.trim() || null,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setNewMemberName("");
      setNewMemberEmail("");
      refetchDetail();
    } else {
      setAddMemberError(data.error ?? "Failed to add member");
    }
  };

  const [requestingPayment, setRequestingPayment] = useState(false);
  const [recordingSettlement, setRecordingSettlement] = useState(false);

  const requestPayment = async (
    email: string | null,
    name: string,
    amount: number,
    groupName: string,
    opts?: { groupId?: string; payerMemberId?: string; receiverMemberId?: string }
  ) => {
    setRequestingPayment(true);
    try {
      const res = await fetch("/api/stripe/create-payment-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          description: groupName,
          recipientName: name,
          groupId: opts?.groupId,
          payerMemberId: opts?.payerMemberId,
          receiverMemberId: opts?.receiverMemberId,
        }),
      });
      const data = await res.json();

      if (res.ok && data.url) {
        await navigator.clipboard.writeText(data.url);
        const payLink = `Pay here: ${data.url}`;
        if (email) {
          const subject = encodeURIComponent(`Payment request: $${amount.toFixed(2)} for ${groupName}`);
          const body = encodeURIComponent(
            `Hey!\n\nYou owe me $${amount.toFixed(2)} for ${groupName}.\n\n${payLink}\n\nThanks!`
          );
          window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
        }
        alert(`Payment link copied! Send it to ${name} to collect $${amount.toFixed(2)}.`);
      } else {
        if (email) {
          const subject = encodeURIComponent(`Payment request: $${amount.toFixed(2)} for ${groupName}`);
          const body = encodeURIComponent(
            `Hey!\n\nYou owe me $${amount.toFixed(2)} for ${groupName}.\n\nPlease pay via Venmo, Cash App, Zelle, or another method.\n\nThanks!`
          );
          window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
        } else {
          alert(`Add ${name}'s email for the fallback, or configure STRIPE_SECRET_KEY (Vercel → Environment Variables) for Stripe links.`);
        }
      }
    } finally {
      setRequestingPayment(false);
    }
  };

  const sendPayment = (email: string | null, name: string, amount: number, groupName: string) => {
    if (!email) {
      alert(`Add ${name}'s email to pay them.`);
      return;
    }
    const subject = encodeURIComponent(`Sending you $${amount.toFixed(2)} for ${groupName}`);
    const body = encodeURIComponent(
      `Hey!\n\nI'm sending you $${amount.toFixed(2)} for ${groupName}.\n\nYou can receive via Venmo, Cash App, Zelle, etc.`
    );
    window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
  };

  const removeFromGroup = async (splitId: string) => {
    if (!selectedId) return;
    const res = await fetch(`/api/split-transactions/${splitId}`, { method: "DELETE" });
    if (res.ok) {
      refetchDetail();
      refetchSummary();
    }
  };

  const recordSettlement = async (
    payerMemberId: string,
    receiverMemberId: string,
    amount: number,
    groupId?: string,
    opts?: { skipState?: boolean }
  ) => {
    if (!opts?.skipState && recordingSettlement) return;
    const gid = groupId ?? selectedId;
    if (!gid) return;
    if (!opts?.skipState) setRecordingSettlement(true);
    try {
    const res = await fetch("/api/settlements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        groupId: gid,
        payerMemberId,
        receiverMemberId,
        amount,
        method: "manual",
      }),
    });
    if (res.ok) {
      refetchDetail();
      refetchPersonDetail();
      refetchSummary();
    } else {
      const data = await res.json();
      alert(data.error ?? "Could not record settlement");
    }
    } finally {
      if (!opts?.skipState) setRecordingSettlement(false);
    }
  };

  if (!showRealUI) {
    return (
      <div className="w-full max-w-2xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight mb-4">Shared Expenses</h1>
        <p className="text-sm text-gray-500 mb-6">
          Create groups, attach bank transactions, split, and settle. Connect your bank to start.
        </p>
        <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center shadow-sm">
          <Users size={40} className="text-gray-300 mx-auto mb-4" />
          <p className="text-sm font-medium text-gray-600">Connect your bank</p>
          <p className="text-xs text-gray-500 mt-1">Create groups and split transactions from real bank data</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto px-4 sm:px-6 py-4 sm:py-6 pb-24 sm:pb-8 min-w-0 overflow-x-hidden">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">Shared Expenses</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#3D8E62] text-white text-sm font-medium hover:bg-[#2D7A52] active:scale-[0.98] transition-transform min-h-[44px]"
        >
          <Plus size={18} />
          Create group
        </button>
      </div>

      {showCreate && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-white rounded-2xl border border-gray-200 p-5 mb-6"
        >
          <h3 className="text-sm font-semibold text-gray-900 mb-3">New group</h3>
          <div className="flex flex-col gap-2">
            <input
              value={newGroupName}
              onChange={(e) => { setNewGroupName(e.target.value); setCreateError(null); }}
              placeholder="Group name"
              className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm min-h-[44px]"
            />
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={createGroup}
                disabled={!newGroupName.trim() || creating}
                className="px-4 py-2.5 rounded-lg bg-[#3D8E62] text-white text-sm font-medium disabled:opacity-50 min-h-[44px]"
              >
                {creating ? "Creating…" : "Create"}
              </button>
              <button
                onClick={() => { setShowCreate(false); setNewGroupName(""); setCreateError(null); }}
                disabled={creating}
                className="px-4 py-2.5 rounded-lg border border-gray-200 text-sm disabled:opacity-50 min-h-[44px]"
              >
                Cancel
              </button>
            </div>
            {createError && (
              <p className="text-sm text-red-600">{createError}</p>
            )}
          </div>
        </motion.div>
      )}

      {loading && !summary ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : !selectedId && !selectedPersonKey ? (
        <div className="space-y-6">
          {/* Overall balance — Splitwise-style */}
          {summary && (
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="text-base text-gray-900">
                <span className="font-medium">Overall, </span>
                {summary.totalIOwe > 0 ? (
                  <span>you owe <strong className="text-amber-600">${summary.totalIOwe.toFixed(2)}</strong></span>
                ) : null}
                {summary.totalIOwe > 0 && summary.totalOwedToMe > 0 && <span> </span>}
                {summary.totalOwedToMe > 0 ? (
                  <span>and you are owed <strong className="text-[#2D7A52]">${summary.totalOwedToMe.toFixed(2)}</strong></span>
                ) : null}
                {summary.totalIOwe === 0 && summary.totalOwedToMe === 0 && (
                  <span className="text-[#2D7A52] font-medium">All settled</span>
                )}
              </div>
            </div>
          )}

          {/* Friends / per-person balances */}
          {summary?.friends && summary.friends.length > 0 && (
            <div className="space-y-2 mb-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider px-1 mb-2">People</h2>
              <div className="space-y-2">
                {summary.friends.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => {
                      setSelectedPersonKey(f.key);
                      setSelectedId(null);
                    }}
                    className="w-full text-left flex items-center justify-between px-4 py-3 rounded-xl bg-white border border-gray-200 hover:border-[#3D8E62]/30 hover:bg-[#F7FAF8] transition-colors min-h-[52px] active:scale-[0.99]"
                  >
                    <span className="font-medium text-gray-900">{f.displayName}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`font-semibold text-sm ${
                          f.balance > 0 ? "text-[#2D7A52]" : f.balance < 0 ? "text-amber-600" : "text-gray-500"
                        }`}
                      >
                        {f.balance > 0 ? "owes you $" : f.balance < 0 ? "you owe $" : "settled up"}
                        {f.balance !== 0 && Math.abs(f.balance).toFixed(2)}
                      </span>
                      <ArrowLeft size={18} className="text-gray-400 rotate-180" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Groups list */}
          {summary?.groups.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center shadow-sm">
              <Users size={40} className="text-gray-300 mx-auto mb-4" />
              <p className="text-sm text-gray-600 font-medium">No groups yet</p>
              <p className="text-xs text-gray-500 mt-1">Create one to split expenses</p>
            </div>
          ) : (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider px-1 mb-2">Groups</h2>
                {(summary?.groups ?? []).map((g) => (
                  <button
                    key={g.id}
                    onClick={() => {
                      setSelectedId(g.id);
                      setSelectedPersonKey(null);
                    }}
                  className="w-full text-left flex items-center justify-between gap-4 px-4 py-4 rounded-xl bg-white border border-gray-200 hover:border-[#3D8E62]/30 hover:bg-[#F7FAF8] transition-colors min-h-[64px] active:scale-[0.99]"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-11 h-11 rounded-xl bg-[#EEF7F2] flex items-center justify-center shrink-0">
                      <Users size={20} className="text-[#3D8E62]" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-900 truncate">{g.name}</div>
                      <div className="text-xs text-gray-500">{g.memberCount} members</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {g.myBalance !== 0 && (
                      <span
                        className={`font-semibold text-sm ${
                          g.myBalance > 0 ? "text-[#2D7A52]" : "text-amber-600"
                        }`}
                      >
                        {g.myBalance > 0 ? "owed $" : "you owe $"}
                        {Math.abs(g.myBalance).toFixed(2)}
                      </span>
                    )}
                    <ArrowLeft size={18} className="text-gray-400 rotate-180" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div>
          <button
            onClick={() => {
              setSelectedId(null);
              setSelectedPersonKey(null);
            }}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-5 min-h-[44px] -ml-1 px-1"
          >
            <ArrowLeft size={16} />
            Back
          </button>

          {selectedPersonKey ? (
            personDetailLoading || !personDetail ? (
              <div className="text-sm text-gray-500">Loading…</div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-4 mb-6">
                  <div className="min-w-0">
                    <h2 className="text-lg sm:text-xl font-bold text-gray-900 truncate">{personDetail.displayName}</h2>
                    <p className="text-sm text-gray-500">
                      {personDetail.balance > 0
                        ? `They owe you $${personDetail.balance.toFixed(2)}`
                        : personDetail.balance < 0
                          ? `You owe them $${Math.abs(personDetail.balance).toFixed(2)}`
                          : "All settled up"}
                    </p>
                  </div>
                  <MemberAvatar name={personDetail.displayName} color={MEMBER_COLORS[0]} />
                </div>

                <div className="mb-6">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Transactions</h3>
                  <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                    {personDetail.activity.length === 0 ? (
                      <div className="px-5 py-8 text-center text-sm text-gray-500">
                        No shared transactions yet.
                      </div>
                    ) : (
                      personDetail.activity.map((a) => (
                        <div
                          key={a.id}
                          className="flex items-center gap-4 px-4 sm:px-5 py-4 min-h-[64px] border-b border-gray-100 last:border-b-0"
                        >
                          <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
                            <Wallet size={18} className="text-gray-500" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-gray-900 truncate">{a.merchant}</div>
                            <div className="text-xs text-gray-500">
                              ${a.amount.toFixed(2)} · {a.groupName}
                              {a.effectOnBalance !== 0 && (
                                <span className={a.effectOnBalance > 0 ? "text-[#2D7A52]" : "text-amber-600"}>
                                  {" "}
                                  {a.effectOnBalance > 0 ? "they owe you" : "you owe"} $
                                  {Math.abs(a.effectOnBalance).toFixed(2)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {personDetail.balance !== 0 && (
                  <div className="mb-6">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Settle</h3>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-4 rounded-xl bg-white border border-gray-200">
                      <span className="text-sm">
                        {personDetail.balance > 0 ? (
                          <>
                            <strong>{personDetail.displayName}</strong> owes you{" "}
                            <strong className="text-[#3D8E62]">${personDetail.balance.toFixed(2)}</strong>
                          </>
                        ) : (
                          <>
                            You owe <strong>{personDetail.displayName}</strong>{" "}
                            <strong className="text-[#3D8E62]">${Math.abs(personDetail.balance).toFixed(2)}</strong>
                          </>
                        )}
                      </span>
                      <div className="flex gap-2 shrink-0">
                        {personDetail.balance > 0 && (
                          <button
                            onClick={() => {
                              const settlements = personDetail.settlements ?? [];
                              const opts =
                                settlements.length === 1
                                  ? {
                                      groupId: settlements[0].groupId,
                                      payerMemberId: settlements[0].fromMemberId,
                                      receiverMemberId: settlements[0].toMemberId,
                                    }
                                  : undefined;
                              requestPayment(
                                personDetail.email,
                                personDetail.displayName,
                                personDetail.balance,
                                "expenses",
                                opts
                              );
                            }}
                            disabled={requestingPayment}
                            className="px-4 py-2 rounded-lg bg-[#3D8E62] text-white text-sm font-medium min-h-[44px] disabled:opacity-50"
                          >
                            {requestingPayment ? "Creating…" : "Request"}
                          </button>
                        )}
                        {personDetail.balance < 0 && (
                          <button
                            onClick={() =>
                              sendPayment(personDetail.email, personDetail.displayName, Math.abs(personDetail.balance), "expenses")
                            }
                            className="px-4 py-2 rounded-lg bg-[#3D8E62] text-white text-sm font-medium min-h-[44px]"
                          >
                            Send
                          </button>
                        )}
                        <button
                          onClick={async () => {
                            if (recordingSettlement) return;
                            const amt = Math.abs(personDetail.balance);
                            const msg = `Mark $${amt.toFixed(2)} with ${personDetail.displayName} as paid? (e.g. cash, Venmo, Zelle)`;
                            if (!window.confirm(msg)) return;
                            const toRecord = personDetail.settlements ?? [];
                            if (toRecord.length === 0) {
                              alert("Open each group to record settlements, or the balance may be split across multiple people.");
                              return;
                            }
                            setRecordingSettlement(true);
                            try {
                              for (const s of toRecord) {
                                await recordSettlement(s.fromMemberId, s.toMemberId, s.amount, s.groupId, { skipState: true });
                              }
                            } finally {
                              setRecordingSettlement(false);
                            }
                          }}
                          disabled={recordingSettlement}
                          className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {recordingSettlement ? "Recording…" : "Mark paid"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {personDetail.balance === 0 && personDetail.activity.length > 0 && (
                  <div className="mb-6 rounded-xl bg-[#EEF7F2] border border-[#C3E0D3] px-4 py-3 text-sm text-[#2D7A52]">
                    All settled up with {personDetail.displayName}.
                  </div>
                )}
              </>
            )
          ) : detailLoading || !detail ? (
            <div className="text-sm text-gray-500">Loading…</div>
          ) : (
            <>
              {/* Group header */}
              <div className="flex items-center justify-between gap-4 mb-6">
                <div className="min-w-0">
                  <h2 className="text-lg sm:text-xl font-bold text-gray-900 truncate">{detail.name}</h2>
                  <p className="text-sm text-gray-500">
                    {detail.members.length} members · ${detail.totalSpend.toFixed(2)} total
                  </p>
                </div>
                <div className="flex -space-x-2 shrink-0">
                  {detail.members.map((m, i) => (
                    <MemberAvatar
                      key={m.id}
                      name={m.display_name}
                      color={MEMBER_COLORS[i % MEMBER_COLORS.length]}
                    />
                  ))}
                </div>
              </div>

              {/* Transactions first */}
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Transactions</h3>
                <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                  {detail.activity.length === 0 ? (
                    <div className="px-5 py-8 text-center text-sm text-gray-500">
                      No shared transactions yet. Add from the Transactions page.
                    </div>
                  ) : (
                    detail.activity.map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center gap-4 px-4 sm:px-5 py-4 min-h-[64px] border-b border-gray-100 last:border-b-0"
                      >
                        <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
                          <Wallet size={18} className="text-gray-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900 truncate">{a.merchant}</div>
                          <div className="text-xs text-gray-500">
                            ${a.amount.toFixed(2)} split {a.splitCount} ways
                          </div>
                        </div>
                        <button
                          onClick={() => removeFromGroup(a.id)}
                          className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
                          title="Remove from group"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Settle — simple, one action per row */}
              {detail.suggestions.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Settle</h3>
                  <div className="space-y-2">
                    {detail.suggestions.map((s) => {
                      const amICreditor = s.toMember?.user_id === user?.id;
                      const amIDebtor = s.fromMember?.user_id === user?.id;
                      const primaryAction =
                        amICreditor
                          ? { label: "Request", onClick: () => requestPayment(s.fromMember?.email ?? null, s.fromMember?.display_name ?? "them", s.amount, detail.name, { groupId: detail.id, payerMemberId: s.fromMemberId, receiverMemberId: s.toMemberId }) }
                          : amIDebtor
                            ? { label: "Send", onClick: () => sendPayment(s.toMember?.email ?? null, s.toMember?.display_name ?? "them", s.amount, detail.name) }
                            : null;
                      return (
                        <div
                          key={`${s.fromMemberId}-${s.toMemberId}-${s.amount}`}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-4 rounded-xl bg-white border border-gray-200 min-h-[64px]"
                        >
                          <span className="text-sm">
                            <strong>{s.fromMember?.display_name ?? "?"}</strong> →{" "}
                            <strong>{s.toMember?.display_name ?? "?"}</strong>{" "}
                            <strong className="text-[#3D8E62]">${s.amount.toFixed(2)}</strong>
                          </span>
                          <div className="flex gap-2 shrink-0">
                            {primaryAction && (
                              <button
                                onClick={primaryAction.onClick}
                                disabled={requestingPayment}
                                className="px-4 py-2 rounded-lg bg-[#3D8E62] text-white text-sm font-medium min-h-[44px] disabled:opacity-50"
                              >
                                {primaryAction.label === "Request" && requestingPayment ? "Creating…" : primaryAction.label}
                              </button>
                            )}
                            <button
                              onClick={() => {
                                const msg = `Mark $${s.amount.toFixed(2)} from ${s.fromMember?.display_name ?? "them"} → ${s.toMember?.display_name ?? "you"} as paid? (e.g. cash, Venmo, Zelle)`;
                                if (window.confirm(msg)) recordSettlement(s.fromMemberId, s.toMemberId, s.amount);
                              }}
                              disabled={recordingSettlement}
                              className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {recordingSettlement ? "Recording…" : "Mark paid"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {detail.balances.filter((b) => b.total !== 0).length === 0 && detail.suggestions.length === 0 && (
                <div className="mb-6 rounded-xl bg-[#EEF7F2] border border-[#C3E0D3] px-4 py-3 text-sm text-[#2D7A52]">
                  All settled up.
                </div>
              )}

              {/* Members — compact */}
              <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Members</h3>
                {detail.isOwner !== false && (
                  <>
                    <div className="flex flex-col sm:flex-row gap-2 mb-3">
                      <input
                        value={newMemberName}
                        onChange={(e) => { setNewMemberName(e.target.value); setAddMemberError(null); }}
                        placeholder="Name"
                        className="flex-1 px-3 py-2.5 rounded-lg border border-gray-200 text-sm min-h-[44px]"
                      />
                      <input
                        type="email"
                        value={newMemberEmail}
                        onChange={(e) => { setNewMemberEmail(e.target.value); setAddMemberError(null); }}
                        placeholder="Email"
                        className="flex-1 px-3 py-2.5 rounded-lg border border-gray-200 text-sm min-h-[44px]"
                      />
                      <button
                        onClick={addMember}
                        disabled={!newMemberName.trim()}
                        className="px-4 py-2.5 rounded-lg bg-[#3D8E62] text-white text-sm font-medium disabled:opacity-50 min-h-[44px] shrink-0"
                      >
                        Add
                      </button>
                    </div>
                    {addMemberError && <p className="text-sm text-red-600 mb-2">{addMemberError}</p>}
                  </>
                )}
                <div className="space-y-1.5">
                  {detail.members.map((m, i) => (
                    <div key={m.id} className="flex items-center gap-2 text-sm">
                      <MemberAvatar name={m.display_name} color={MEMBER_COLORS[i % MEMBER_COLORS.length]} />
                      <span className="font-medium">{m.display_name}</span>
                      {m.email && <span className="text-gray-500 text-xs">{m.email}</span>}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

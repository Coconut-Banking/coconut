"use client";

import {
  Users,
  Plus,
  ArrowLeft,
  ChevronRight,
  X,
  CheckCircle2,
  Wallet,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import {
  useGroupsSummary,
  useGroupDetail,
  usePersonDetail,
  useRecentActivity,
  type PersonDetail,
} from "@/hooks/useGroups";
import { useTransactions } from "@/hooks/useTransactions";

const MEMBER_COLORS = ["#3D8E62", "#4A6CF7", "#E8507A", "#F59E0B", "#10A37F", "#FF5A5F"];
const ACTIVITY_ICONS: Record<string, string> = {
  "Food & Drink": "🍽️",
  "Travel": "✈️",
  "Shopping": "🛒",
  "Entertainment": "🎬",
  default: "💳",
};

function Avatar({
  initials,
  color,
  size = "md",
}: {
  initials: string;
  color: string;
  size?: "sm" | "md" | "lg";
}) {
  const cls =
    size === "sm"
      ? "w-8 h-8 text-xs rounded-full"
      : size === "lg"
        ? "w-12 h-12 text-base rounded-full"
        : "w-10 h-10 text-sm rounded-full";
  return (
    <div
      className={`${cls} flex items-center justify-center text-white font-semibold shrink-0`}
      style={{ backgroundColor: color }}
    >
      {initials}
    </div>
  );
}

function GroupIcon({ emoji, size = "md" }: { emoji: string; size?: "sm" | "md" }) {
  const cls = size === "sm" ? "w-8 h-8 text-base rounded-xl" : "w-10 h-10 text-xl rounded-xl";
  return (
    <div
      className={`${cls} bg-[#F0F9F4] border border-[#C3E0D3] flex items-center justify-center shrink-0`}
    >
      {emoji}
    </div>
  );
}

// ── Add Expense modal ─────────────────────────────────────────────────────
function AddExpenseModal({
  onClose,
  onSuccess,
  groups,
  friends,
  selectedGroupId,
  selectedPersonKey,
}: {
  onClose: () => void;
  onSuccess: () => void;
  groups: { id: string; name: string }[];
  friends: { key: string; displayName: string }[];
  selectedGroupId: string | null;
  selectedPersonKey: string | null;
}) {
  const [groupId, setGroupId] = useState<string | null>(selectedGroupId);
  const [personKey, setPersonKey] = useState<string | null>(selectedPersonKey);
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { user } = useUser();
  const { detail: groupDetail } = useGroupDetail(groupId);

  const save = async () => {
    const amt = parseFloat(amount);
    if (!groupId || !amt || amt <= 0) {
      setError("Select a group and enter a valid amount.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/manual-expense", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupId,
          description: desc.trim() || "Expense",
          amount: amt,
          personKey: personKey || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setDesc("");
        setAmount("");
        setGroupId(null);
        setPersonKey(null);
        onSuccess();
        onClose();
      } else {
        setError(data.error ?? "Failed to add expense");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ type: "spring", damping: 28, stiffness: 320 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-6"
      >
        <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col">
          <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 shrink-0">
            <h3 className="text-base font-bold text-gray-900">Add an expense</h3>
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
          <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1 min-h-0">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">
                In group
              </label>
              {groups.length === 0 ? (
                <p className="text-sm text-amber-600 py-3">
                  Create a group first to add expenses.
                </p>
              ) : (
                <select
                  value={groupId ?? ""}
                  onChange={(e) => {
                    setGroupId(e.target.value || null);
                    setPersonKey(null);
                  }}
                  className="w-full px-3.5 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/20 focus:border-[#3D8E62]"
                >
                  <option value="">Select a group…</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {groupId && groupDetail && (
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">
                  Split with (optional)
                </label>
                <div className="space-y-2">
                  <button
                    onClick={() => setPersonKey(null)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all text-left ${
                      !personKey ? "border-[#3D8E62] bg-[#EEF7F2]" : "border-gray-100 hover:border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    <Users size={16} className="text-gray-500" />
                    <span className="text-sm font-medium text-gray-800">Everyone in group</span>
                    <div
                      className={`ml-auto w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                        !personKey ? "border-[#3D8E62] bg-[#3D8E62]" : "border-gray-300"
                      }`}
                    >
                      {!personKey && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                    </div>
                  </button>
                  {groupDetail.members
                    .filter((m) => m.user_id !== user?.id)
                    .map((m) => {
                      const key = m.user_id ?? m.email ?? `${groupId}-${m.id}`;
                      const isSelected = personKey === key;
                      return (
                        <button
                          key={m.id}
                          onClick={() => setPersonKey(isSelected ? null : key)}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all text-left ${
                            isSelected ? "border-[#3D8E62] bg-[#EEF7F2]" : "border-gray-100 hover:border-gray-200 hover:bg-gray-50"
                          }`}
                        >
                          <Avatar
                            initials={m.display_name.slice(0, 2).toUpperCase()}
                            color={MEMBER_COLORS[0]}
                            size="sm"
                          />
                          <span className="text-sm font-medium text-gray-800">{m.display_name}</span>
                          <div
                            className={`ml-auto w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                              isSelected ? "border-[#3D8E62] bg-[#3D8E62]" : "border-gray-300"
                            }`}
                          >
                            {isSelected && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                          </div>
                        </button>
                      );
                    })}
                </div>
              </div>
            )}

            <div className="border-t border-gray-100 pt-4 space-y-3">
              <input
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="What's it for?"
                className="w-full px-3.5 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/20 focus:border-[#3D8E62]"
              />
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">
                  $
                </span>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  type="number"
                  step="0.01"
                  className="w-full pl-8 pr-3.5 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/20 focus:border-[#3D8E62]"
                />
              </div>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <div className="px-6 pb-6 flex gap-3 shrink-0">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={groups.length === 0 || !groupId || !amount || parseFloat(amount) <= 0 || saving}
              className="flex-1 py-2.5 rounded-xl bg-[#3D8E62] hover:bg-[#2D7A52] disabled:opacity-50 text-white text-sm font-semibold transition-colors"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </motion.div>
    </>
  );
}

// ── Settle Up modal ───────────────────────────────────────────────────────
function SettleModal({
  person,
  onClose,
  onSuccess,
  onRequestPayment,
  recordSettlement,
}: {
  person: { key: string; displayName: string; balance: number; initials: string; color: string };
  onClose: () => void;
  onSuccess: () => void;
  onRequestPayment: () => void;
  recordSettlement: () => Promise<void>;
}) {
  const [done, setDone] = useState(false);
  const [recording, setRecording] = useState(false);
  const direction = person.balance > 0 ? "owes_you" : "you_owe";
  const amount = Math.abs(person.balance);

  const handleRecord = async () => {
    setRecording(true);
    try {
      await recordSettlement();
      setDone(true);
      onSuccess();
    } finally {
      setRecording(false);
    }
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ type: "spring", damping: 28, stiffness: 320 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-6"
      >
        <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden">
          <div className="px-6 py-8 text-center">
            <Avatar initials={person.initials} color={person.color} size="lg" />
            <div className="mt-4 mb-1 text-lg font-bold text-gray-900">
              {direction === "owes_you" ? `${person.displayName} owes you` : `You owe ${person.displayName}`}
            </div>
            <div
              className={`text-3xl font-bold ${
                direction === "owes_you" ? "text-[#3D8E62]" : "text-red-500"
              }`}
            >
              ${amount.toFixed(2)}
            </div>
            {done ? (
              <div className="mt-6 flex items-center justify-center gap-2 text-[#3D8E62] font-semibold">
                <CheckCircle2 size={18} /> All settled!
              </div>
            ) : (
              <div className="mt-6 space-y-3">
                {direction === "owes_you" && (
                  <button
                    onClick={() => {
                      onRequestPayment();
                      onClose();
                    }}
                    className="w-full py-3 rounded-xl border border-[#3D8E62] text-[#3D8E62] font-semibold hover:bg-[#EEF7F2] transition-colors"
                  >
                    Request payment
                  </button>
                )}
                <button
                  onClick={handleRecord}
                  disabled={recording}
                  className="w-full py-3 rounded-xl bg-[#3D8E62] hover:bg-[#2D7A52] disabled:opacity-50 text-white font-semibold transition-colors"
                >
                  {recording
                    ? "Recording…"
                    : direction === "owes_you"
                      ? "Mark as settled"
                      : "Record payment"}
                </button>
                <button
                  onClick={onClose}
                  className="w-full py-2.5 rounded-xl border border-gray-200 text-sm text-gray-500 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────
export default function SharedPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useUser();
  const { linked } = useTransactions();
  const { summary, loading, refetch: refetchSummary } = useGroupsSummary();
  const { activity, loading: activityLoading, refetch: refetchActivity } = useRecentActivity(linked);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedPersonKey, setSelectedPersonKey] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [settleTarget, setSettleTarget] = useState<{
    key: string;
    displayName: string;
    balance: number;
    initials: string;
    color: string;
  } | null>(null);
  const [expandedPerson, setExpandedPerson] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [addMemberError, setAddMemberError] = useState<string | null>(null);
  const [requestingPayment, setRequestingPayment] = useState(false);
  const [recordingSettlement, setRecordingSettlement] = useState(false);
  const [paymentLink, setPaymentLink] = useState<string | null>(null);

  const { detail: groupDetail, refetch: refetchGroupDetail } = useGroupDetail(selectedId);
  const { detail: personDetail, loading: personDetailLoading, refetch: refetchPersonDetail } = usePersonDetail(
    settleTarget?.key ?? expandedPerson ?? selectedPersonKey ?? null
  );

  const showRealUI = linked;

  useEffect(() => {
    if (!selectedId && !selectedPersonKey && showRealUI) refetchSummary();
  }, [selectedId, selectedPersonKey, showRealUI, refetchSummary]);

  useEffect(() => {
    if (showAdd || settleTarget) {
      refetchActivity();
    }
  }, [showAdd, settleTarget, refetchActivity]);

  useEffect(() => {
    setPaymentLink(null);
  }, [selectedId, selectedPersonKey]);

  useEffect(() => {
    if (searchParams.get("stripe") !== "success" || !showRealUI) return;
    const t = setTimeout(() => {
      refetchSummary();
      if (selectedId) refetchGroupDetail();
      if (selectedPersonKey) refetchPersonDetail();
      router.replace("/app/shared");
    }, 2500);
    return () => clearTimeout(t);
  }, [searchParams, showRealUI, refetchSummary, refetchGroupDetail, refetchPersonDetail, selectedId, selectedPersonKey, router]);

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
      refetchGroupDetail();
    } else {
      setAddMemberError(data.error ?? "Failed to add member");
    }
  };

  const requestPayment = async (
    email: string | null,
    name: string,
    amount: number,
    groupName = "expenses",
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
        setPaymentLink(data.url);
        await navigator.clipboard.writeText(data.url);
      }
    } finally {
      setRequestingPayment(false);
    }
  };

  const recordSettlement = async (
    payerMemberId: string,
    receiverMemberId: string,
    amount: number,
    groupId: string,
    opts?: { skipState?: boolean }
  ) => {
    if (!opts?.skipState && recordingSettlement) return;
    if (!opts?.skipState) setRecordingSettlement(true);
    try {
      const res = await fetch("/api/settlements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupId,
          payerMemberId,
          receiverMemberId,
          amount,
          method: "manual",
        }),
      });
      if (res.ok) {
        refetchGroupDetail();
        refetchPersonDetail();
        refetchSummary();
      }
    } finally {
      if (!opts?.skipState) setRecordingSettlement(false);
    }
  };

  const goBack = () => {
    setSelectedId(null);
    setSelectedPersonKey(null);
    setExpandedPerson(null);
    refetchSummary();
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
          <p className="text-xs text-gray-500 mt-1">
            Create groups and split transactions from real bank data
          </p>
        </div>
      </div>
    );
  }

  // Group detail view
  if (selectedId && groupDetail) {
    return (
      <div className="w-full max-w-2xl mx-auto px-4 sm:px-6 py-4 sm:py-6 pb-24 sm:pb-8">
        <button onClick={goBack} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-5 -ml-1 px-1">
          <ArrowLeft size={16} /> Back
        </button>
        <div className="flex items-center justify-between gap-4 mb-6">
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-bold text-gray-900 truncate">{groupDetail.name}</h2>
            <p className="text-sm text-gray-500">
              {groupDetail.members.length} members · $
              {groupDetail.totalSpend?.toFixed(2) ?? "0.00"} total
            </p>
          </div>
          <div className="flex -space-x-2 shrink-0">
            {groupDetail.members.slice(0, 4).map((m, i) => (
              <Avatar key={m.id} initials={m.display_name.slice(0, 2).toUpperCase()} color={MEMBER_COLORS[i % MEMBER_COLORS.length]} />
            ))}
          </div>
        </div>
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Transactions</h3>
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
            {groupDetail.activity?.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-gray-500">No shared transactions yet.</div>
            ) : (
              (groupDetail.activity ?? []).map((a) => (
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
                </div>
              ))
            )}
          </div>
        </div>
        {groupDetail.suggestions && groupDetail.suggestions.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Settle</h3>
            <div className="space-y-2">
              {groupDetail.suggestions.map((s) => (
                  <div
                    key={`${s.fromMemberId}-${s.toMemberId}`}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-4 rounded-xl bg-white border border-gray-200"
                  >
                    <span className="text-sm">
                      <strong>{s.fromMember?.display_name ?? "?"}</strong> →{" "}
                      <strong>{s.toMember?.display_name ?? "?"}</strong>{" "}
                      <strong className="text-[#3D8E62]">${s.amount.toFixed(2)}</strong>
                    </span>
                    <button
                      onClick={() => {
                        if (window.confirm(`Mark $${s.amount.toFixed(2)} as paid?`)) {
                          recordSettlement(s.fromMemberId, s.toMemberId, s.amount, selectedId!, { skipState: true });
                          refetchGroupDetail();
                          refetchSummary();
                        }
                      }}
                      disabled={recordingSettlement}
                      className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {recordingSettlement ? "Recording…" : "Mark paid"}
                    </button>
                  </div>
              ))}
            </div>
          </div>
        )}
        {groupDetail.isOwner !== false && (
          <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Members</h3>
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
            <div className="space-y-1.5">
              {groupDetail.members.map((m, i) => (
                <div key={m.id} className="flex items-center gap-2 text-sm">
                  <Avatar initials={m.display_name.slice(0, 2).toUpperCase()} color={MEMBER_COLORS[i % MEMBER_COLORS.length]} size="sm" />
                  <span className="font-medium">{m.display_name}</span>
                  {m.email && <span className="text-gray-500 text-xs">{m.email}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Person detail view (simplified - could be expanded)
  if (selectedPersonKey) {
    if (personDetailLoading || !personDetail) {
      return (
        <div className="w-full max-w-2xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
          <button onClick={goBack} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-5">
            <ArrowLeft size={16} /> Back
          </button>
          <div className="text-sm text-gray-500 py-12">Loading…</div>
        </div>
      );
    }
    const pd = personDetail as PersonDetail;
    return (
      <div className="w-full max-w-2xl mx-auto px-4 sm:px-6 py-4 sm:py-6 pb-24 sm:pb-8">
        <button onClick={goBack} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-5 -ml-1 px-1">
          <ArrowLeft size={16} /> Back
        </button>
        <div className="flex items-center justify-between gap-4 mb-6">
          <Avatar initials={pd.displayName.slice(0, 2).toUpperCase()} color={MEMBER_COLORS[0]} size="lg" />
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-bold text-gray-900 truncate">{pd.displayName}</h2>
            <p className="text-sm text-gray-500">
              {pd.balance > 0
                ? `They owe you $${pd.balance.toFixed(2)}`
                : pd.balance < 0
                  ? `You owe $${Math.abs(pd.balance).toFixed(2)}`
                  : "All settled up"}
            </p>
          </div>
        </div>
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Transactions</h3>
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
            {pd.activity.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-gray-500">No shared transactions yet.</div>
            ) : (
              pd.activity.map((a) => (
                <div key={a.id} className="flex items-center gap-4 px-4 sm:px-5 py-4 min-h-[64px] border-b border-gray-100 last:border-b-0">
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
        {pd.balance !== 0 && (
          <div className="flex gap-2">
            {pd.balance > 0 && (
              <button
                onClick={() => {
                  const s = (pd.settlements ?? [])[0];
                  requestPayment(
                    pd.email,
                    pd.displayName,
                    pd.balance,
                    "expenses",
                    s ? { groupId: s.groupId, payerMemberId: s.fromMemberId, receiverMemberId: s.toMemberId } : undefined
                  );
                }}
                disabled={requestingPayment}
                className="px-4 py-2 rounded-lg bg-[#3D8E62] text-white text-sm font-medium min-h-[44px] disabled:opacity-50"
              >
                {requestingPayment ? "Creating…" : "Request"}
              </button>
            )}
            <button
              onClick={async () => {
                if (!window.confirm(`Mark $${Math.abs(pd.balance).toFixed(2)} as paid?`)) return;
                setRecordingSettlement(true);
                try {
                  for (const s of pd.settlements ?? []) {
                    await recordSettlement(s.fromMemberId, s.toMemberId, s.amount, s.groupId, { skipState: true });
                  }
                  refetchSummary();
                  refetchPersonDetail();
                  goBack();
                } finally {
                  setRecordingSettlement(false);
                }
              }}
              disabled={recordingSettlement}
              className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 min-h-[44px] disabled:opacity-50"
            >
              {recordingSettlement ? "Recording…" : "Mark paid"}
            </button>
          </div>
        )}
      </div>
    );
  }

  // Main overview
  const netOwed = summary?.totalOwedToMe ?? 0;
  const netOwing = summary?.totalIOwe ?? 0;
  const netBalance = (summary?.netBalance ?? netOwed - netOwing) || 0;

  const people =
    summary?.friends?.map((f, i) => ({
      id: f.key,
      name: f.displayName,
      initials: f.displayName.slice(0, 2).toUpperCase(),
      color: MEMBER_COLORS[i % MEMBER_COLORS.length],
      direction:
        f.balance > 0 ? ("owes_you" as const) : f.balance < 0 ? ("you_owe" as const) : ("settled" as const),
      amount: Math.abs(f.balance),
      breakdown: [] as { in: string; amount: number; them_owe: boolean }[],
    })) ?? [];

  const groupsData =
    summary?.groups?.map((g) => ({
      id: g.id,
      name: g.name,
      emoji: "🏔️",
      memberCount: g.memberCount,
      direction:
        g.myBalance > 0 ? ("owed" as const) : g.myBalance < 0 ? ("you_owe" as const) : ("settled" as const),
      amount: Math.abs(g.myBalance ?? 0),
      lastActivity: formatTimeAgo(g.lastActivityAt),
    })) ?? [];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-8 py-6 sm:py-8">
      <div className="flex items-center justify-between mb-7">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Shared</h1>
          <p className="text-sm text-gray-400 mt-0.5">Expenses with friends and groups</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 bg-[#3D8E62] hover:bg-[#2D7A52] text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors shadow-sm"
          >
            <Plus size={15} />
            Add expense
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 border border-gray-200 hover:bg-gray-50 text-gray-700 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors"
          >
            <Users size={15} />
            Create group
          </button>
        </div>
      </div>

      {showCreate && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl border border-gray-200 p-5 mb-6 shadow-sm"
        >
          <h3 className="text-sm font-semibold text-gray-900 mb-3">New group</h3>
          <input
            value={newGroupName}
            onChange={(e) => { setNewGroupName(e.target.value); setCreateError(null); }}
            placeholder="Group name"
            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm min-h-[44px] mb-3"
          />
          <div className="flex gap-2">
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
          {createError && <p className="text-sm text-red-600 mt-2">{createError}</p>}
        </motion.div>
      )}

      {loading && !summary ? (
        <div className="text-sm text-gray-500 py-12">Loading…</div>
      ) : (
        <>
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={`rounded-2xl border px-6 py-5 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 ${
              netBalance > 0
                ? "bg-[#F0F9F4] border-[#C3E0D3]"
                : netBalance < 0
                  ? "bg-red-50 border-red-100"
                  : "bg-gray-50 border-gray-200"
            }`}
          >
            <div>
              <p className="text-sm text-gray-500 mb-1">Overall</p>
              <p className="text-base text-gray-800">
                {netBalance > 0 ? (
                  <>
                    You are owed <span className="text-xl font-bold text-[#3D8E62]">${netBalance.toFixed(2)}</span>
                  </>
                ) : netBalance < 0 ? (
                  <>
                    You owe <span className="text-xl font-bold text-red-500">${Math.abs(netBalance).toFixed(2)}</span>
                  </>
                ) : (
                  <span className="text-xl font-bold text-gray-700">All settled up</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-6 text-sm">
              <div className="text-right">
                <p className="text-xs text-gray-400 mb-0.5">Owed to you</p>
                <p className="font-bold text-[#3D8E62]">${netOwed.toFixed(2)}</p>
              </div>
              <div className="w-px h-8 bg-gray-200 hidden sm:block" />
              <div className="text-right">
                <p className="text-xs text-gray-400 mb-0.5">You owe</p>
                <p className="font-bold text-red-500">${netOwing.toFixed(2)}</p>
              </div>
            </div>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-3 space-y-6">
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 px-0.5">People</p>
                <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden divide-y divide-gray-50 shadow-sm">
                  {people.length === 0 ? (
                    <div className="px-5 py-8 text-center text-sm text-gray-500">No people yet. Create a group to get started.</div>
                  ) : (
                    people.map((person) => (
                      <PersonRow
                        key={person.id}
                        person={person}
                        expanded={expandedPerson === person.id}
                        personDetail={expandedPerson === person.id ? personDetail : null}
                        onToggle={() => setExpandedPerson(expandedPerson === person.id ? null : person.id)}
                        onSettleUp={() => {
                          setSettleTarget({
                            key: person.id,
                            displayName: person.name,
                            balance: person.direction === "owes_you" ? person.amount : -person.amount,
                            initials: person.initials,
                            color: person.color,
                          });
                          setExpandedPerson(null);
                        }}
                        onRemind={() => {
                          const pd = personDetail as PersonDetail | null;
                          if (pd) {
                            const s = (pd.settlements ?? [])[0];
                            requestPayment(
                              pd.email,
                              pd.displayName,
                              person.amount,
                              "expenses",
                              s ? { groupId: s.groupId, payerMemberId: s.fromMemberId, receiverMemberId: s.toMemberId } : undefined
                            );
                          }
                          setExpandedPerson(null);
                        }}
                        onViewDetails={() => setSelectedPersonKey(person.id)}
                      />
                    ))
                  )}
                </div>
              </div>

              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 px-0.5">Groups</p>
                <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden divide-y divide-gray-50 shadow-sm">
                  {groupsData.map((group) => (
                    <motion.div
                      key={group.id}
                      className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors cursor-pointer"
                      onClick={() => setSelectedId(group.id)}
                    >
                      <GroupIcon emoji={group.emoji} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900">{group.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {group.memberCount} members · {group.lastActivity}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {group.direction === "owed" && (
                          <div className="text-right">
                            <p className="text-xs text-gray-400">owed</p>
                            <p className="text-sm font-bold text-[#3D8E62]">${group.amount.toFixed(2)}</p>
                          </div>
                        )}
                        {group.direction === "you_owe" && (
                          <div className="text-right">
                            <p className="text-xs text-gray-400">you owe</p>
                            <p className="text-sm font-bold text-red-500">${group.amount.toFixed(2)}</p>
                          </div>
                        )}
                        {group.direction === "settled" && <p className="text-sm text-gray-400">settled up</p>}
                        <ChevronRight size={15} className="text-gray-300" />
                      </div>
                    </motion.div>
                  ))}
                  <button
                    onClick={() => setShowCreate(true)}
                    className="flex items-center gap-4 px-5 py-4 w-full hover:bg-gray-50 transition-colors text-left"
                  >
                    <div className="w-10 h-10 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center shrink-0">
                      <Plus size={15} className="text-gray-400" />
                    </div>
                    <p className="text-sm text-gray-400 font-medium">Create a new group</p>
                  </button>
                </div>
              </div>
            </div>

            <div className="lg:col-span-2">
              <div className="lg:sticky lg:top-4">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 px-0.5">Recent activity</p>
                <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
                  {activityLoading ? (
                    <div className="px-4 py-8 text-center text-sm text-gray-500">Loading…</div>
                  ) : activity.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-gray-500">No recent activity</div>
                  ) : (
                    activity.map((item, i) => (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: i * 0.03 }}
                        className={`flex items-start gap-3.5 px-4 py-4 ${i < activity.length - 1 ? "border-b border-gray-50" : ""}`}
                      >
                        <div
                          className="w-9 h-9 rounded-xl flex items-center justify-center text-base shrink-0 bg-[#EEF7F2]"
                          style={{ color: item.direction === "get_back" ? "#3D8E62" : item.direction === "owe" ? "#DC2626" : "#6B7280" }}
                        >
                          {ACTIVITY_ICONS.default}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-gray-700 leading-relaxed">
                            <span className="font-semibold">{item.who}</span> {item.action}
                            {item.what ? ` "${item.what}"` : ""}
                            {item.in ? ` in "${item.in}"` : ""}
                            {item.what === "" && "."}
                          </p>
                          {item.direction !== "settled" && (
                            <p
                              className={`text-xs font-semibold mt-0.5 ${
                                item.direction === "get_back" ? "text-[#3D8E62]" : "text-red-500"
                              }`}
                            >
                              {item.direction === "get_back"
                                ? `You get back $${item.amount.toFixed(2)}`
                                : `You owe $${item.amount.toFixed(2)}`}
                            </p>
                          )}
                          <p className="text-[10px] text-gray-400 mt-1">{item.time}</p>
                        </div>
                      </motion.div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      <AnimatePresence>
        {showAdd && (
          <AddExpenseModal
            onClose={() => setShowAdd(false)}
            onSuccess={() => { refetchSummary(); refetchActivity(); }}
            groups={summary?.groups?.map((g) => ({ id: g.id, name: g.name })) ?? []}
            friends={summary?.friends?.map((f) => ({ key: f.key, displayName: f.displayName })) ?? []}
            selectedGroupId={null}
            selectedPersonKey={null}
          />
        )}
        {settleTarget && (
          <SettleModal
            person={settleTarget}
            onClose={() => setSettleTarget(null)}
            onSuccess={() => {
              refetchSummary();
              refetchActivity();
              setSettleTarget(null);
            }}
            onRequestPayment={() => {
              const pd = personDetail as PersonDetail | null;
              const s = pd?.settlements?.[0];
              requestPayment(
                pd?.email ?? null,
                settleTarget.displayName,
                Math.abs(settleTarget.balance),
                "expenses",
                s ? { groupId: s.groupId, payerMemberId: s.fromMemberId, receiverMemberId: s.toMemberId } : undefined
              );
            }}
            recordSettlement={async () => {
              const pd = personDetail as PersonDetail | null;
              if (!pd?.settlements?.length) {
                const res = await fetch(`/api/groups/person?key=${encodeURIComponent(settleTarget.key)}`);
                const data = await res.json();
                const s = data.settlements ?? [];
                for (const x of s) {
                  await recordSettlement(x.fromMemberId, x.toMemberId, x.amount, x.groupId, { skipState: true });
                }
                refetchSummary();
              } else {
                for (const s of pd.settlements) {
                  await recordSettlement(s.fromMemberId, s.toMemberId, s.amount, s.groupId, { skipState: true });
                }
                refetchSummary();
              }
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function PersonRow({
  person,
  expanded,
  personDetail,
  onToggle,
  onSettleUp,
  onRemind,
  onViewDetails,
}: {
  person: {
    id: string;
    name: string;
    initials: string;
    color: string;
    direction: "owes_you" | "you_owe" | "settled";
    amount: number;
    breakdown: { in: string; amount: number; them_owe: boolean }[];
  };
  expanded: boolean;
  personDetail: PersonDetail | null;
  onToggle: () => void;
  onSettleUp: () => void;
  onRemind: () => void;
  onViewDetails: () => void;
}) {
  const breakdown = (() => {
    const byGroup = new Map<string, number>();
    for (const a of personDetail?.activity ?? []) {
      const cur = byGroup.get(a.groupName) ?? 0;
      byGroup.set(a.groupName, Math.round((cur + a.effectOnBalance) * 100) / 100);
    }
    return Array.from(byGroup.entries())
      .filter(([, v]) => v !== 0)
      .map(([inGroup, net]) => ({
        in: inGroup,
        amount: Math.abs(net),
        them_owe: net > 0,
      }));
  })();

  return (
    <div>
      <motion.div
        className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors cursor-pointer"
        onClick={onToggle}
      >
        <Avatar initials={person.initials} color={person.color} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">{person.name}</p>
          {breakdown.length > 0 && (
            <p className="text-xs text-gray-400 mt-0.5 truncate">
              {breakdown[0].in}
              {breakdown.length > 1 ? ` +${breakdown.length - 1} more` : ""}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {person.direction === "owes_you" && (
            <div className="text-right">
              <p className="text-xs text-gray-400">owes you</p>
              <p className="text-sm font-bold text-[#3D8E62]">${person.amount.toFixed(2)}</p>
            </div>
          )}
          {person.direction === "you_owe" && (
            <div className="text-right">
              <p className="text-xs text-gray-400">you owe</p>
              <p className="text-sm font-bold text-red-500">${person.amount.toFixed(2)}</p>
            </div>
          )}
          {person.direction === "settled" && <p className="text-sm text-gray-400 font-medium">settled up</p>}
          <ChevronRight size={15} className={`text-gray-300 transition-transform ${expanded ? "rotate-90" : ""}`} />
        </div>
      </motion.div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-4 ml-14 space-y-2">
              {personDetail?.activity?.length ? (
                <>
                  {breakdown.map((b, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-gray-500">
                        {b.them_owe ? `${person.name} owes you` : `You owe ${person.name}`}{" "}
                        <span className="text-gray-700 font-medium">${b.amount.toFixed(2)}</span> in{" "}
                        <span className="text-gray-700">{b.in}</span>
                      </span>
                    </div>
                  ))}
                  {person.direction !== "settled" && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {person.direction === "owes_you" && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onRemind(); }}
                          className="text-xs font-semibold text-[#3D8E62] hover:underline"
                        >
                          Remind →
                        </button>
                      )}
                      {(person.direction === "owes_you" || person.direction === "you_owe") && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onSettleUp(); }}
                          className="text-xs font-semibold text-[#3D8E62] hover:underline"
                        >
                          Settle up →
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); onViewDetails(); }}
                        className="text-xs font-semibold text-gray-500 hover:underline"
                      >
                        View details →
                      </button>
                    </div>
                  )}
                </>
              ) : personDetail ? (
                <p className="text-xs text-gray-400">All clear between you two.</p>
              ) : (
                <p className="text-xs text-gray-400">Loading breakdown…</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function formatTimeAgo(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

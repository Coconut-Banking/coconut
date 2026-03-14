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
import { useState, useEffect, Suspense } from "react";
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
import { useCurrency } from "@/hooks/useCurrency";

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
  friends: _friends,
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
  const { format: fc, symbol: currSymbol } = useCurrency();
  const [groupId, setGroupId] = useState<string | null>(selectedGroupId);
  const [personKey, setPersonKey] = useState<string | null>(selectedPersonKey);
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [payerMemberId, setPayerMemberId] = useState<string | null>(null);
  const [splitMode, setSplitMode] = useState<"equal" | "person" | "custom">("equal");
  const [customShares, setCustomShares] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { user } = useUser();
  const { detail: groupDetail } = useGroupDetail(groupId);

  const members = groupDetail?.members ?? [];
  const currentUserMember = members.find((m) => m.user_id === user?.id);

  const amt = parseFloat(amount) || 0;
  const customSharesValid = (() => {
    if (splitMode !== "custom" || amt <= 0) return false;
    const sumCents = Object.values(customShares).reduce(
      (s, v) => s + Math.round((parseFloat(v) || 0) * 100), 0
    );
    return Math.abs(sumCents - Math.round(amt * 100)) <= 1;
  })();

  const save = async () => {
    if (!groupId || !amt || amt <= 0) {
      setError("Select a group and enter a valid amount.");
      return;
    }
    if (splitMode === "custom" && !customSharesValid) {
      setError("Custom amounts must add up to the total.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        groupId,
        description: desc.trim() || "Expense",
        amount: amt,
        payerMemberId: payerMemberId || currentUserMember?.id || undefined,
      };
      if (splitMode === "person" && personKey) payload.personKey = personKey;
      if (splitMode === "custom" && customSharesValid) {
        payload.shares = Object.entries(customShares)
          .filter(([, v]) => parseFloat(v) > 0)
          .map(([memberId, v]) => ({ memberId, amount: parseFloat(v) }));
      }
      const res = await fetch("/api/manual-expense", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        setDesc("");
        setAmount("");
        setGroupId(null);
        setPersonKey(null);
        setPayerMemberId(null);
        setCustomShares({});
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

  const initCustomShares = (total = amt) => {
    if (!groupDetail || !members.length || total <= 0) return;
    const totalCents = Math.round(total * 100);
    const baseCents = Math.floor(totalCents / members.length);
    const remainderCents = totalCents - baseCents * members.length;
    const next: Record<string, string> = {};
    members.forEach((m, i) => {
      next[m.id] = ((baseCents + (i < remainderCents ? 1 : 0)) / 100).toFixed(2);
    });
    setCustomShares(next);
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/30 backdrop-blur-md z-40"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ type: "spring", damping: 30, stiffness: 400 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden max-h-[92vh] flex flex-col border border-gray-100">
          <div className="flex items-center justify-between px-6 py-5 shrink-0 bg-gradient-to-b from-gray-50/80 to-white border-b border-gray-100">
            <h3 className="text-lg font-bold text-gray-900 tracking-tight">Add expense</h3>
            <button
              onClick={onClose}
              aria-label="Close add expense"
              className="w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 transition-colors"
            >
              <X size={18} />
            </button>
          </div>
          <div className="px-6 py-5 space-y-5 overflow-y-auto flex-1 min-h-0">
            <div>
              <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2 block">
                Amount
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-lg font-medium">{currSymbol}</span>
                <input
                  value={amount}
                  onChange={(e) => {
                    const v = e.target.value;
                    setAmount(v);
                    if (splitMode === "custom") {
                      const n = parseFloat(v) || 0;
                      if (n > 0) initCustomShares(n);
                    }
                  }}
                  placeholder="0.00"
                  type="number"
                  step="0.01"
                  autoFocus
                  className="w-full pl-9 pr-4 py-3.5 text-lg font-semibold border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/30 focus:border-[#3D8E62] bg-gray-50/50"
                />
              </div>
            </div>
            <div>
              <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2 block">
                What for
              </label>
              <input
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="Dinner, groceries, rent…"
                className="w-full px-4 py-3 text-sm border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/30 focus:border-[#3D8E62] bg-gray-50/50"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2 block">
                Group
              </label>
              {groups.length === 0 ? (
                <p className="text-sm text-amber-600 py-4 px-4 rounded-2xl bg-amber-50 border border-amber-100">
                  Create a group first to add expenses.
                </p>
              ) : (
                <select
                  value={groupId ?? ""}
                  onChange={(e) => {
                    setGroupId(e.target.value || null);
                    setPersonKey(null);
                    setCustomShares({});
                  }}
                  className="w-full px-4 py-3 text-sm border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/30 focus:border-[#3D8E62] bg-gray-50/50"
                >
                  <option value="">Select a group</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {groupId && groupDetail && members.length > 0 && (
              <>
                <div>
                  <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2 block">
                    Paid by
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {members.map((m, i) => {
                      const isPayer = (payerMemberId ?? currentUserMember?.id) === m.id;
                      return (
                        <button
                          key={m.id}
                          onClick={() => setPayerMemberId(m.id)}
                          className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-all ${
                            isPayer
                              ? "border-[#3D8E62] bg-[#EEF7F2] text-[#2D7A52]"
                              : "border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-gray-600"
                          }`}
                        >
                          <Avatar initials={m.display_name.slice(0, 2).toUpperCase()} color={MEMBER_COLORS[i % MEMBER_COLORS.length]} size="sm" />
                          {m.user_id === user?.id ? "You" : m.display_name}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2 block">
                    Split
                  </label>
                  <div className="space-y-2">
                    <button
                      onClick={() => { setSplitMode("equal"); setPersonKey(null); }}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all text-left ${
                        splitMode === "equal" ? "border-[#3D8E62] bg-[#EEF7F2]" : "border-gray-100 hover:border-gray-200 hover:bg-gray-50/50"
                      }`}
                    >
                      <Users size={18} className="text-gray-500 shrink-0" />
                      <span className="text-sm font-medium">Split equally</span>
                      {splitMode === "equal" && <div className="ml-auto w-2 h-2 rounded-full bg-[#3D8E62]" />}
                    </button>
                    {members.filter((m) => m.user_id !== user?.id).map((m) => {
                      const key = m.user_id ?? m.email ?? `${groupId}-${m.id}`;
                      const isSelected = splitMode === "person" && personKey === key;
                      return (
                        <button
                          key={m.id}
                          onClick={() => { setSplitMode("person"); setPersonKey(isSelected ? null : key); }}
                          className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all text-left ${
                            isSelected ? "border-[#3D8E62] bg-[#EEF7F2]" : "border-gray-100 hover:border-gray-200 hover:bg-gray-50/50"
                          }`}
                        >
                          <Avatar initials={m.display_name.slice(0, 2).toUpperCase()} color={MEMBER_COLORS[members.indexOf(m) % MEMBER_COLORS.length]} size="sm" />
                          <span className="text-sm font-medium">Split with {m.display_name}</span>
                          {isSelected && <div className="ml-auto w-2 h-2 rounded-full bg-[#3D8E62]" />}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => {
                        setSplitMode("custom");
                        setPersonKey(null);
                        initCustomShares();
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all text-left ${
                        splitMode === "custom" ? "border-[#3D8E62] bg-[#EEF7F2]" : "border-gray-100 hover:border-gray-200 hover:bg-gray-50/50"
                      }`}
                    >
                      <span className="text-base">✏️</span>
                      <span className="text-sm font-medium">Custom amounts</span>
                      {splitMode === "custom" && <div className="ml-auto w-2 h-2 rounded-full bg-[#3D8E62]" />}
                    </button>
                  </div>
                </div>
                {splitMode === "custom" && amt > 0 && (
                  <div className="space-y-2 pt-1">
                    <p className="text-xs text-gray-500">Enter each person&apos;s share (must total {fc(amt)})</p>
                    {members.map((m, i) => (
                      <div key={m.id} className="flex items-center gap-3">
                        <Avatar initials={m.display_name.slice(0, 2).toUpperCase()} color={MEMBER_COLORS[i % MEMBER_COLORS.length]} size="sm" />
                        <span className="text-sm font-medium w-24 truncate">{m.user_id === user?.id ? "You" : m.display_name}</span>
                        <div className="flex-1 relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{currSymbol}</span>
                            <input
                            value={customShares[m.id] ?? ""}
                            onChange={(e) => setCustomShares((prev) => ({ ...prev, [m.id]: e.target.value }))}
                            placeholder="0"
                            type="number"
                            step="0.01"
                            aria-label={`Share for ${m.user_id === user?.id ? "You" : m.display_name}`}
                            className="w-full pl-7 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/20"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
          </div>
          <div className="px-6 pb-6 pt-2 flex gap-3 shrink-0 bg-gray-50/30">
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-2xl border border-gray-200 text-sm text-gray-600 font-semibold hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={
                groups.length === 0 ||
                !groupId ||
                !amount ||
                amt <= 0 ||
                saving ||
                (splitMode === "custom" && !customSharesValid)
              }
              className="flex-1 py-3 rounded-2xl bg-[#3D8E62] hover:bg-[#2D7A52] disabled:opacity-50 text-white text-sm font-semibold transition-colors shadow-lg shadow-[#3D8E62]/20"
            >
              {saving ? "Saving…" : "Add expense"}
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
  const { format: fc } = useCurrency();
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
        className="fixed inset-0 bg-black/30 backdrop-blur-md z-40"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ type: "spring", damping: 30, stiffness: 400 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden border border-gray-100">
          <div className="px-6 py-10 text-center">
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              className="inline-flex"
            >
              <Avatar initials={person.initials} color={person.color} size="lg" />
            </motion.div>
            <div className="mt-5 mb-1 text-base font-semibold text-gray-600">
              {direction === "owes_you" ? `${person.displayName} owes you` : `You owe ${person.displayName}`}
            </div>
            <div
              className={`text-4xl font-bold tracking-tight ${
                direction === "owes_you" ? "text-[#3D8E62]" : "text-red-500"
              }`}
            >
              {fc(amount)}
            </div>
            {done ? (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6 flex items-center justify-center gap-2 text-[#3D8E62] font-semibold"
              >
                <CheckCircle2 size={20} /> All settled!
              </motion.div>
            ) : (
              <div className="mt-8 space-y-2">
                {direction === "owes_you" && (
                  <button
                    onClick={() => {
                      onRequestPayment();
                      onClose();
                    }}
                    className="w-full py-3.5 rounded-2xl border-2 border-[#3D8E62] text-[#3D8E62] font-semibold hover:bg-[#EEF7F2] transition-colors"
                  >
                    Request payment
                  </button>
                )}
                <button
                  onClick={handleRecord}
                  disabled={recording}
                  className="w-full py-3.5 rounded-2xl bg-[#3D8E62] hover:bg-[#2D7A52] disabled:opacity-50 text-white font-semibold transition-colors shadow-lg shadow-[#3D8E62]/20"
                >
                  {recording
                    ? "Recording…"
                    : direction === "owes_you"
                      ? "Mark as settled"
                      : "Record payment"}
                </button>
                <button
                  onClick={onClose}
                  className="w-full py-2.5 rounded-2xl text-sm text-gray-500 hover:bg-gray-50 transition-colors"
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
function SharedPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user: _user } = useUser();
  const { linked, loading: txLoading } = useTransactions();
  const { format: fc, formatAbs: fca } = useCurrency();
  const { summary, loading, error: summaryError, refetch: refetchSummary } = useGroupsSummary();
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
  const [newGroupType, setNewGroupType] = useState<string>("other");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [addMemberError, setAddMemberError] = useState<string | null>(null);
  const [requestingPayment, setRequestingPayment] = useState(false);
  const [recordingSettlement, setRecordingSettlement] = useState(false);

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
        body: JSON.stringify({
          name: newGroupName.trim(),
          ownerDisplayName: "You",
          group_type: ["home", "trip", "couple", "other"].includes(newGroupType) ? newGroupType : "other",
        }),
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
    _email: string | null,
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

  if (txLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-8 py-8">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-[#3D8E62]/30 border-t-[#3D8E62] rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Loading shared expenses...</p>
        </div>
      </div>
    );
  }

  if (!showRealUI) {
    return (
      <div className="w-full max-w-2xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight mb-4">Shared Expenses</h1>
        <p className="text-sm text-gray-500 mb-6">
          Create groups, attach bank transactions, split, and settle. Connect your bank to start.
        </p>
        <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center shadow-sm">
          <Users size={40} className="text-gray-400 mx-auto mb-4" />
          <p className="text-sm font-medium text-gray-600">Connect your bank</p>
          <p className="text-xs text-gray-500 mt-1 mb-4">
            Create groups and split transactions from real bank data
          </p>
          <a
            href="/connect"
            className="inline-flex items-center gap-2 bg-[#3D8E62] hover:bg-[#2D7A52] text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
          >
            Connect bank
          </a>
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
                      {fc(a.amount)} · {(a as { paidByDisplayName?: string }).paidByDisplayName ?? "Someone"} paid · split {a.splitCount} ways
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
                      <strong className="text-[#3D8E62]">{fc(s.amount)}</strong>
                    </span>
                    <button
                      onClick={() => {
                        if (window.confirm(`Mark ${fc(s.amount)} as paid?`)) {
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
                aria-label="New member name"
                className="flex-1 px-3 py-2.5 rounded-lg border border-gray-200 text-sm min-h-[44px]"
              />
              <input
                type="email"
                value={newMemberEmail}
                onChange={(e) => { setNewMemberEmail(e.target.value); setAddMemberError(null); }}
                placeholder="Email"
                aria-label="New member email"
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
                ? `They owe you ${fc(pd.balance)}`
                : pd.balance < 0
                  ? `You owe ${fca(pd.balance)}`
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
                      {fc(a.amount)} · {a.groupName}
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
                if (!window.confirm(`Mark ${fca(pd.balance)} as paid?`)) return;
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

  const GROUP_EMOJI: Record<string, string> = { home: "🏠", trip: "✈️", couple: "💑", other: "👥" };
  const groupsData =
    summary?.groups?.map((g) => ({
      id: g.id,
      name: g.name,
      emoji: GROUP_EMOJI[(g as { groupType?: string }).groupType ?? "other"] ?? "👥",
      memberCount: g.memberCount,
      direction:
        g.myBalance > 0 ? ("owed" as const) : g.myBalance < 0 ? ("you_owe" as const) : ("settled" as const),
      amount: Math.abs(g.myBalance ?? 0),
      lastActivity: formatTimeAgo(g.lastActivityAt),
    })) ?? [];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-8 py-6 sm:py-8">
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">Shared</h1>
            <p className="text-sm text-gray-500 mt-1">Split expenses with friends, roommates & trips</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setShowAdd(true)}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-[#3D8E62] hover:bg-[#2D7A52] text-white px-5 py-3.5 rounded-2xl text-sm font-semibold transition-all shadow-lg shadow-[#3D8E62]/25 hover:shadow-[#3D8E62]/30 hover:-translate-y-0.5"
            >
              <Plus size={18} strokeWidth={2.5} />
              Add expense
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 border border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-3 rounded-2xl text-sm font-medium transition-colors"
            >
              <Users size={18} />
              New group
            </button>
          </div>
        </div>
      </div>

      {showCreate && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl border border-gray-100 p-6 mb-6 shadow-lg shadow-gray-200/50"
        >
          <h3 className="text-base font-bold text-gray-900 mb-4">New group</h3>
          <div className="space-y-4">
            <div>
              <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 block">Name</label>
              <input
                value={newGroupName}
                onChange={(e) => { setNewGroupName(e.target.value); setCreateError(null); }}
                placeholder="e.g. Apartment, Vegas Trip"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/30"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2 block">Type</label>
              <div className="flex gap-2 flex-wrap">
                {[
                  { id: "home", label: "🏠 Home", desc: "Roommates" },
                  { id: "trip", label: "✈️ Trip", desc: "Travel" },
                  { id: "couple", label: "💑 Couple", desc: "Partners" },
                  { id: "other", label: "👥 Other", desc: "Friends" },
                ].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setNewGroupType(t.id)}
                    className={`px-4 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                      newGroupType === t.id ? "border-[#3D8E62] bg-[#EEF7F2] text-[#2D7A52]" : "border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={createGroup}
                disabled={!newGroupName.trim() || creating}
                className="flex-1 py-3 rounded-xl bg-[#3D8E62] text-white text-sm font-semibold disabled:opacity-50 hover:bg-[#2D7A52] transition-colors"
              >
                {creating ? "Creating…" : "Create"}
              </button>
              <button
                onClick={() => { setShowCreate(false); setNewGroupName(""); setCreateError(null); }}
                disabled={creating}
                className="px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
          {createError && <p className="text-sm text-red-600 mt-3">{createError}</p>}
        </motion.div>
      )}

      {summaryError ? (
        <div className="rounded-2xl border border-red-100 bg-red-50 px-6 py-8 text-center mb-6">
          <p className="text-sm font-medium text-red-700 mb-3">{summaryError}</p>
          <button
            onClick={() => refetchSummary()}
            className="px-4 py-2 rounded-xl bg-[#3D8E62] hover:bg-[#2D7A52] text-white text-sm font-medium transition-colors"
          >
            Try again
          </button>
        </div>
      ) : loading && !summary ? (
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
                    You are owed <span className="text-xl font-bold text-[#3D8E62]">{fc(netBalance)}</span>
                  </>
                ) : netBalance < 0 ? (
                  <>
                    You owe <span className="text-xl font-bold text-red-500">{fca(netBalance)}</span>
                  </>
                ) : (
                  <span className="text-xl font-bold text-gray-700">All settled up</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-6 text-sm">
              <div className="text-right">
                <p className="text-xs text-gray-400 mb-0.5">Owed to you</p>
                <p className="font-bold text-[#3D8E62]">{fc(netOwed)}</p>
              </div>
              <div className="w-px h-8 bg-gray-200 hidden sm:block" />
              <div className="text-right">
                <p className="text-xs text-gray-400 mb-0.5">You owe</p>
                <p className="font-bold text-red-500">{fc(netOwing)}</p>
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
                  {groupsData.length === 0 && (
                    <div className="px-5 py-8 text-center text-sm text-gray-500">No groups yet. Create one to split expenses.</div>
                  )}
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
                            <p className="text-sm font-bold text-[#3D8E62]">{fc(group.amount)}</p>
                          </div>
                        )}
                        {group.direction === "you_owe" && (
                          <div className="text-right">
                            <p className="text-xs text-gray-400">you owe</p>
                            <p className="text-sm font-bold text-red-500">{fc(group.amount)}</p>
                          </div>
                        )}
                        {group.direction === "settled" && <p className="text-sm text-gray-400">settled up</p>}
                        <ChevronRight size={15} className="text-gray-400" />
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
                                ? `You get back ${fc(item.amount)}`
                                : `You owe ${fc(item.amount)}`}
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

export default function SharedPage() {
  return (
    <Suspense fallback={
      <div className="max-w-5xl mx-auto px-4 sm:px-8 py-6 sm:py-8">
        <div className="h-8 w-48 bg-gray-200 rounded animate-pulse mb-6" />
        <div className="h-64 bg-gray-100 rounded-2xl animate-pulse" />
      </div>
    }>
      <SharedPageContent />
    </Suspense>
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
  const { format: fc } = useCurrency();
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
              <p className="text-sm font-bold text-[#3D8E62]">{fc(person.amount)}</p>
            </div>
          )}
          {person.direction === "you_owe" && (
            <div className="text-right">
              <p className="text-xs text-gray-400">you owe</p>
              <p className="text-sm font-bold text-red-500">{fc(person.amount)}</p>
            </div>
          )}
          {person.direction === "settled" && <p className="text-sm text-gray-400 font-medium">settled up</p>}
          <ChevronRight size={15} className={`text-gray-400 transition-transform ${expanded ? "rotate-90" : ""}`} />
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
                        <span className="text-gray-700 font-medium">{fc(b.amount)}</span> in{" "}
                        <span className="text-gray-700">{b.in}</span>
                      </span>
                    </div>
                  ))}
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

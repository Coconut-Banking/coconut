"use client";

import {
  Users,
  Plus,
  ArrowLeft,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  X,
  Check,
  CheckCircle2,
  Wallet,
  Nfc,
  Equal,
  Hash,
  DollarSign,
  Sliders,
  Zap,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import {
  useGroupsSummary,
  useGroupDetail,
  usePersonDetail,
  useRecentActivity,
  type PersonDetail,
  type GroupSummary,
  type FriendBalance,
} from "@/hooks/useGroups";
import { useTransactions } from "@/hooks/useTransactions";
import { useCurrency } from "@/hooks/useCurrency";
import { getP2PDeepLinks } from "@/lib/p2p-deeplinks";

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

// ── Add Expense modal (3-step flow) ───────────────────────────────────────
type ExpenseSplitMode = "equal" | "amount" | "percent" | "shares" | "adjustment";
const GROUP_EMOJI: Record<string, string> = { home: "🏠", trip: "✈️", couple: "💑", other: "👥" };

interface PeopleDataItem {
  displayName: string;
  email: string | null;
  groupId: string;
  groupName: string;
  memberId: string;
  memberCount: number;
}

function AddExpenseModal({
  onClose,
  onSuccess,
  summaryGroups,
  summaryFriends,
  selectedGroupId,
  selectedPersonKey,
}: {
  onClose: () => void;
  onSuccess: () => void;
  summaryGroups: GroupSummary[];
  summaryFriends: FriendBalance[];
  selectedGroupId: string | null;
  selectedPersonKey: string | null;
}) {
  const { format: fc, symbol: currSymbol } = useCurrency();
  const { user } = useUser();

  // Step management
  const [step, setStep] = useState<1 | 2 | 3>(selectedGroupId ? 2 : 1);

  // Step 1: "With whom?"
  const [groupId, setGroupId] = useState<string | null>(selectedGroupId);
  const [selectedFriendKeys, setSelectedFriendKeys] = useState<string[]>(
    selectedPersonKey ? [selectedPersonKey] : []
  );
  const [peopleData, setPeopleData] = useState<PeopleDataItem[]>([]);
  const [resolveError, setResolveError] = useState<string | null>(null);

  // Step 2: "Enter details"
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [payerMemberId, setPayerMemberId] = useState<string | null>(null);
  const [splitMode, setSplitMode] = useState<ExpenseSplitMode>("equal");
  const [customShares, setCustomShares] = useState<Record<string, string>>({});
  const [showPaidBySheet, setShowPaidBySheet] = useState(false);
  const [showSplitMethodSheet, setShowSplitMethodSheet] = useState(false);
  const [showSplitDetailSheet, setShowSplitDetailSheet] = useState(false);

  // Step 3: Summary / save
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settledPersons, setSettledPersons] = useState<string[]>([]);
  const [settlingPerson, setSettlingPerson] = useState<string | null>(null);

  // Data hooks
  const { detail: groupDetail } = useGroupDetail(groupId);
  const members = groupDetail?.members ?? [];
  const currentUserMember = members.find((m) => m.user_id === user?.id);
  const effectivePayerId = payerMemberId ?? currentUserMember?.id ?? null;
  const amt = parseFloat(amount) || 0;

  // Fetch people data on mount for friend→group mapping
  useEffect(() => {
    fetch("/api/groups/people")
      .then((r) => (r.ok ? r.json() : { people: [] }))
      .then((d) => setPeopleData(Array.isArray(d.people) ? d.people : []))
      .catch(() => {});
  }, []);

  // Compute per-member shares for display and API
  const computeShares = useCallback((): Record<string, number> => {
    if (!members.length || amt <= 0) return {};
    const result: Record<string, number> = {};

    switch (splitMode) {
      case "equal": {
        const share = amt / members.length;
        members.forEach((m) => { result[m.id] = share; });
        break;
      }
      case "amount": {
        members.forEach((m) => {
          result[m.id] = parseFloat(customShares[m.id] || "0");
        });
        break;
      }
      case "percent": {
        members.forEach((m) => {
          const pct = parseFloat(customShares[m.id] || "0");
          result[m.id] = Math.round(amt * (pct / 100) * 100) / 100;
        });
        break;
      }
      case "shares": {
        const total = members.reduce(
          (s, m) => s + (parseFloat(customShares[m.id] || "1") || 0), 0
        );
        if (total > 0) {
          members.forEach((m) => {
            const sh = parseFloat(customShares[m.id] || "1") || 0;
            result[m.id] = Math.round(amt * (sh / total) * 100) / 100;
          });
        }
        break;
      }
      case "adjustment": {
        const base = amt / members.length;
        members.forEach((m) => {
          const adj = parseFloat(customShares[m.id] || "0");
          result[m.id] = Math.round((base + adj) * 100) / 100;
        });
        break;
      }
    }
    return result;
  }, [members, amt, splitMode, customShares]);

  const shares = computeShares();
  const equalShare = members.length > 0 ? amt / members.length : 0;

  // People who owe the payer
  const oweList = (() => {
    if (!effectivePayerId || !members.length) return [];
    const payerIsMe = effectivePayerId === currentUserMember?.id;
    return members
      .filter((m) => m.id !== effectivePayerId)
      .filter((m) => (shares[m.id] ?? 0) > 0)
      .map((m) => ({
        memberId: m.id,
        displayName: m.user_id === user?.id ? "You" : m.display_name,
        initials: m.display_name.slice(0, 2).toUpperCase(),
        amount: shares[m.id] ?? 0,
        isMe: m.user_id === user?.id,
        payerIsMe,
      }));
  })();

  // Resolve friend keys to a group when transitioning from step 1 → 2
  const resolveAndContinue = () => {
    setResolveError(null);
    if (selectedFriendKeys.length === 0) return;

    // Find groups that contain ALL selected friends
    const friendGroups = selectedFriendKeys.map((key) => {
      const match = peopleData.find(
        (p) => (p.email === key || p.memberId === key || p.displayName === key) ||
          key.includes(p.memberId)
      );
      return match;
    });

    if (friendGroups.some((f) => !f)) {
      setResolveError("Could not find all selected friends. Try selecting a group instead.");
      return;
    }

    // Check if all are in same group
    const groupIds = new Set(friendGroups.map((f) => f!.groupId));
    if (groupIds.size === 1) {
      setGroupId(friendGroups[0]!.groupId);
      setStep(2);
      return;
    }

    // Try to find a group that contains all selected friends
    const allGroupIds = summaryGroups.map((g) => g.id);
    for (const gId of allGroupIds) {
      const groupPeople = peopleData.filter((p) => p.groupId === gId);
      const groupPeopleKeys = new Set(
        groupPeople.flatMap((p) => [p.email, p.memberId, p.displayName].filter(Boolean))
      );
      const allFound = selectedFriendKeys.every((key) =>
        groupPeopleKeys.has(key) ||
        groupPeople.some((p) => key.includes(p.memberId))
      );
      if (allFound) {
        setGroupId(gId);
        setStep(2);
        return;
      }
    }

    // Default: use first friend's group
    setGroupId(friendGroups[0]!.groupId);
    setStep(2);
  };

  const toggleFriend = (key: string) => {
    setSelectedFriendKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
    setResolveError(null);
  };

  const initShares = (mode: ExpenseSplitMode, total = amt) => {
    if (!members.length || total <= 0) return;
    const next: Record<string, string> = {};
    switch (mode) {
      case "amount": {
        const perPerson = (total / members.length).toFixed(2);
        members.forEach((m) => { next[m.id] = perPerson; });
        break;
      }
      case "percent": {
        const pct = (100 / members.length).toFixed(0);
        members.forEach((m) => { next[m.id] = pct; });
        break;
      }
      case "shares":
        members.forEach((m) => { next[m.id] = "1"; });
        break;
      case "adjustment":
        members.forEach((m) => { next[m.id] = "0"; });
        break;
    }
    setCustomShares(next);
  };

  const sharesValidForApi = (() => {
    if (splitMode === "equal") return true;
    if (amt <= 0) return false;
    if (splitMode === "amount") {
      const sum = members.reduce((s, m) => s + (parseFloat(customShares[m.id] || "0")), 0);
      return Math.abs(Math.round(sum * 100) - Math.round(amt * 100)) <= 1;
    }
    if (splitMode === "percent") {
      const sum = members.reduce((s, m) => s + (parseFloat(customShares[m.id] || "0")), 0);
      return Math.abs(sum - 100) < 0.5;
    }
    return true; // shares and adjustment always valid
  })();

  // Save expense via API
  const save = async () => {
    if (!groupId || amt <= 0) {
      setError("Select a group and enter a valid amount.");
      return;
    }
    if (!sharesValidForApi) {
      setError("Shares must add up to the total amount.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        groupId,
        description: desc.trim() || "Expense",
        amount: amt,
        payerMemberId: effectivePayerId || undefined,
      };
      if (splitMode !== "equal") {
        const apiShares = members
          .map((m) => ({ memberId: m.id, amount: shares[m.id] ?? 0 }))
          .filter((s) => s.amount > 0);
        payload.shares = apiShares;
      }
      const res = await fetch("/api/manual-expense", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
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

  // Create a Stripe payment link for settlement
  const handleSettle = async (memberId: string, memberAmount: number) => {
    if (settlingPerson) return;
    setSettlingPerson(memberId);
    try {
      const receiverMember = currentUserMember;
      const res = await fetch("/api/stripe/create-payment-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: memberAmount,
          description: desc || "Expense settlement",
          recipientName: members.find((m) => m.id === memberId)?.display_name ?? "Friend",
          groupId: groupId || undefined,
          payerMemberId: memberId,
          receiverMemberId: receiverMember?.id,
        }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        await navigator.clipboard.writeText(data.url);
        setSettledPersons((prev) => [...prev, memberId]);
      }
    } catch {
      // Silently handle — user can retry
    } finally {
      setSettlingPerson(null);
    }
  };

  const payerName =
    effectivePayerId === currentUserMember?.id
      ? "you"
      : members.find((m) => m.id === effectivePayerId)?.display_name ?? "you";

  const splitModeLabel =
    splitMode === "equal" ? "equally"
    : splitMode === "amount" ? "by amount"
    : splitMode === "percent" ? "by %"
    : splitMode === "shares" ? "by shares"
    : "by adjustment";

  const canReview = amt > 0 && desc.trim().length > 0 && groupId && sharesValidForApi;

  // ── STEP 1: With whom? ─────────────────────────────────────────────────
  if (step === 1) {
    return (
      <>
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
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
            {/* Header */}
            <div className="flex items-center px-6 py-5 shrink-0 border-b border-gray-100">
              <button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 transition-colors">
                <X size={18} />
              </button>
              <h3 className="flex-1 text-lg font-bold text-gray-900 tracking-tight text-center">With whom?</h3>
              <div className="w-9" />
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 min-h-0">
              {/* Groups */}
              {summaryGroups.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-3">Groups</p>
                  <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
                    {summaryGroups.map((g, i) => (
                      <button
                        key={g.id}
                        onClick={() => { setGroupId(g.id); setStep(2); }}
                        className={`w-full flex items-center gap-4 px-4 py-3.5 hover:bg-gray-50 transition-colors text-left ${i < summaryGroups.length - 1 ? "border-b border-gray-50" : ""}`}
                      >
                        <div className="w-11 h-11 rounded-xl bg-[#F0F9F4] border border-[#C3E0D3] flex items-center justify-center text-xl shrink-0">
                          {GROUP_EMOJI[g.groupType ?? "other"] ?? "👥"}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900">{g.name}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{g.memberCount} people</p>
                        </div>
                        <ChevronRight size={16} className="text-gray-300 shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Friends */}
              {summaryFriends.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-3">Friends</p>
                  <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
                    {summaryFriends.map((f, i) => {
                      const selected = selectedFriendKeys.includes(f.key);
                      return (
                        <button
                          key={f.key}
                          onClick={() => toggleFriend(f.key)}
                          className={`w-full flex items-center gap-4 px-4 py-3.5 hover:bg-gray-50 transition-colors text-left ${i < summaryFriends.length - 1 ? "border-b border-gray-50" : ""}`}
                        >
                          <Avatar
                            initials={f.displayName.slice(0, 2).toUpperCase()}
                            color={MEMBER_COLORS[i % MEMBER_COLORS.length]}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-900">{f.displayName}</p>
                          </div>
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                            selected ? "border-[#3D8E62] bg-[#3D8E62]" : "border-gray-300"
                          }`}>
                            {selected && <Check size={12} className="text-white" strokeWidth={3} />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {summaryGroups.length === 0 && summaryFriends.length === 0 && (
                <div className="py-12 text-center">
                  <p className="text-sm text-gray-500">Create a group first to split expenses.</p>
                </div>
              )}

              {resolveError && <p className="text-sm text-red-600 font-medium">{resolveError}</p>}
            </div>

            {selectedFriendKeys.length > 0 && (
              <div className="px-6 pb-6 pt-2 shrink-0">
                <button
                  onClick={resolveAndContinue}
                  className="w-full py-3.5 rounded-2xl bg-[#3D8E62] hover:bg-[#2D7A52] text-white text-sm font-semibold transition-colors shadow-lg shadow-[#3D8E62]/20"
                >
                  Continue with {selectedFriendKeys.length}{" "}
                  {selectedFriendKeys.length === 1 ? "person" : "people"} →
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </>
    );
  }

  // ── STEP 2: Enter details ──────────────────────────────────────────────
  if (step === 2) {
    return (
      <>
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
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
            {/* Header */}
            <div className="flex items-center px-6 py-5 shrink-0 border-b border-gray-100">
              <button onClick={() => setStep(1)} className="w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 transition-colors">
                <ChevronLeft size={18} />
              </button>
              <h3 className="flex-1 text-lg font-bold text-gray-900 tracking-tight text-center">Enter details</h3>
              <div className="w-9" />
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 min-h-0">
              {/* Description */}
              <div>
                <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2 block">Description</label>
                <input
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  placeholder="What's this for?"
                  autoFocus
                  className="w-full px-4 py-3.5 text-sm font-semibold border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/30 focus:border-[#3D8E62] bg-gray-50/50"
                />
              </div>

              {/* Amount */}
              <div>
                <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2 block">Amount</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xl font-bold">{currSymbol}</span>
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    type="number"
                    step="0.01"
                    className="w-full pl-10 pr-4 py-3.5 text-2xl font-bold border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/30 focus:border-[#3D8E62] bg-gray-50/50 tabular-nums"
                  />
                </div>
              </div>

              {/* Paid by + Split method */}
              <div className="flex items-center justify-center gap-1 px-4 py-4 rounded-2xl bg-gray-50 border border-gray-100 text-sm text-gray-600">
                <span>Paid by</span>
                <button
                  onClick={() => setShowPaidBySheet(true)}
                  className="px-2.5 py-0.5 rounded-lg bg-white border border-gray-200 hover:border-[#3D8E62] transition-colors"
                >
                  <span className="font-bold text-gray-900">{payerName}</span>
                </button>
                <span>and split</span>
                <button
                  onClick={() => setShowSplitMethodSheet(true)}
                  className="px-2.5 py-0.5 rounded-lg bg-white border border-gray-200 hover:border-[#3D8E62] transition-colors"
                >
                  <span className="font-bold text-gray-900">{splitModeLabel}</span>
                </button>
              </div>

              {amt > 0 && members.length > 0 && splitMode === "equal" && (
                <p className="text-xs text-gray-400 text-center">
                  {currSymbol}{equalShare.toFixed(2)} per person
                </p>
              )}
            </div>

            <div className="px-6 pb-6 pt-2 shrink-0">
              <button
                onClick={() => setStep(3)}
                disabled={!canReview}
                className="w-full py-3.5 rounded-2xl bg-[#3D8E62] hover:bg-[#2D7A52] disabled:opacity-50 text-white text-sm font-semibold transition-colors shadow-lg shadow-[#3D8E62]/20"
              >
                Review summary →
              </button>
            </div>
          </div>
        </motion.div>

        {/* ── Paid by sub-sheet ── */}
        <AnimatePresence>
          {showPaidBySheet && (
            <>
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setShowPaidBySheet(false)}
                className="fixed inset-0 bg-black/20 z-[60]"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                transition={{ type: "spring", damping: 30, stiffness: 400 }}
                className="fixed inset-0 z-[70] flex items-center justify-center p-4"
              >
                <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden max-h-[70vh] flex flex-col border border-gray-100">
                  <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                    <h4 className="text-base font-bold text-gray-900">Paid by</h4>
                    <button onClick={() => setShowPaidBySheet(false)} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center">
                      <X size={16} className="text-gray-500" />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-1">
                    {members.map((m, i) => {
                      const isSelected = (effectivePayerId) === m.id;
                      return (
                        <button
                          key={m.id}
                          onClick={() => { setPayerMemberId(m.id); setShowPaidBySheet(false); }}
                          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-left ${
                            isSelected ? "bg-[#EEF7F2] border border-[#3D8E62]/30" : "hover:bg-gray-50 border border-transparent"
                          }`}
                        >
                          <Avatar initials={m.display_name.slice(0, 2).toUpperCase()} color={MEMBER_COLORS[i % MEMBER_COLORS.length]} size="sm" />
                          <span className="flex-1 text-sm font-medium text-gray-900">{m.user_id === user?.id ? "You" : m.display_name}</span>
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                            isSelected ? "border-[#3D8E62] bg-[#3D8E62]" : "border-gray-300"
                          }`}>
                            {isSelected && <div className="w-2 h-2 rounded-full bg-white" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* ── Split method sub-sheet ── */}
        <AnimatePresence>
          {showSplitMethodSheet && (
            <>
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setShowSplitMethodSheet(false)}
                className="fixed inset-0 bg-black/20 z-[60]"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                transition={{ type: "spring", damping: 30, stiffness: 400 }}
                className="fixed inset-0 z-[70] flex items-center justify-center p-4"
              >
                <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden max-h-[80vh] flex flex-col border border-gray-100">
                  <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                    <h4 className="text-lg font-bold text-gray-900">Split method</h4>
                    <button onClick={() => setShowSplitMethodSheet(false)} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center">
                      <X size={16} className="text-gray-500" />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-1">
                    {([
                      { mode: "equal" as const, Icon: Equal, title: "Split equally", desc: amt > 0 && members.length > 0 ? `${currSymbol}${equalShare.toFixed(2)} each` : "Even split" },
                      { mode: "amount" as const, Icon: DollarSign, title: "Unequal amounts", desc: "Enter exact amounts" },
                      { mode: "percent" as const, Icon: Hash, title: "By percentages", desc: "Split by % of total" },
                      { mode: "shares" as const, Icon: Sliders, title: "By shares", desc: "Use ratio (e.g., 2:1:1)" },
                      { mode: "adjustment" as const, Icon: Zap, title: "By adjustment", desc: "Adjust from equal split" },
                    ]).map(({ mode, Icon, title, desc: modeDesc }) => {
                      const isSelected = splitMode === mode;
                      return (
                        <button
                          key={mode}
                          onClick={() => {
                            setSplitMode(mode);
                            if (mode === "equal") {
                              setShowSplitMethodSheet(false);
                            } else {
                              initShares(mode);
                              setShowSplitMethodSheet(false);
                              setShowSplitDetailSheet(true);
                            }
                          }}
                          className={`w-full flex items-center gap-4 px-4 py-4 rounded-xl transition-all text-left ${
                            isSelected ? "bg-[#EEF7F2] border border-[#3D8E62]/30" : "hover:bg-gray-50 border border-transparent"
                          }`}
                        >
                          <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
                            <Icon size={18} className="text-gray-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-900">{title}</p>
                            <p className="text-xs text-gray-400 mt-0.5">{modeDesc}</p>
                          </div>
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                            isSelected ? "border-[#3D8E62] bg-[#3D8E62]" : "border-gray-300"
                          }`}>
                            {isSelected && <div className="w-2 h-2 rounded-full bg-white" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* ── Split detail sub-sheet ── */}
        <AnimatePresence>
          {showSplitDetailSheet && (
            <>
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setShowSplitDetailSheet(false)}
                className="fixed inset-0 bg-black/20 z-[80]"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                transition={{ type: "spring", damping: 30, stiffness: 400 }}
                className="fixed inset-0 z-[90] flex items-center justify-center p-4"
              >
                <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden max-h-[85vh] flex flex-col border border-gray-100">
                  <div className="flex items-center px-6 py-4 border-b border-gray-100">
                    <button onClick={() => setShowSplitDetailSheet(false)} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center">
                      <ChevronLeft size={16} className="text-gray-500" />
                    </button>
                    <h4 className="flex-1 text-base font-bold text-gray-900 text-center">
                      {splitMode === "amount" ? "By amounts" : splitMode === "percent" ? "By percentages" : splitMode === "shares" ? "By shares" : "Adjustments"}
                    </h4>
                    <button onClick={() => setShowSplitDetailSheet(false)} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center">
                      <X size={16} className="text-gray-500" />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                      {members.map((m, i) => {
                        const val = customShares[m.id] ?? "";
                        return (
                          <div key={m.id} className={`flex items-center gap-3 px-4 py-3 ${i < members.length - 1 ? "border-b border-gray-50" : ""}`}>
                            <Avatar initials={m.display_name.slice(0, 2).toUpperCase()} color={MEMBER_COLORS[i % MEMBER_COLORS.length]} size="sm" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900">{m.user_id === user?.id ? "You" : m.display_name}</p>
                              <p className="text-xs text-gray-400">
                                {splitMode === "shares" && `${val || "1"} share${(val || "1") === "1" ? "" : "s"}`}
                                {splitMode === "amount" && `${currSymbol}${val || "0"}`}
                                {splitMode === "percent" && `${val || "0"}%`}
                                {splitMode === "adjustment" && `${Number(val) >= 0 ? "+" : ""}${currSymbol}${val || "0"}`}
                              </p>
                            </div>
                            <input
                              type="number"
                              value={val}
                              onChange={(e) => setCustomShares((prev) => ({ ...prev, [m.id]: e.target.value }))}
                              className="w-20 px-3 py-2 text-sm font-bold text-right border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/20 focus:border-[#3D8E62] bg-gray-50/50"
                              step={splitMode === "shares" ? "1" : "0.01"}
                            />
                          </div>
                        );
                      })}
                    </div>

                    {/* Remaining / total indicator */}
                    <div className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-xl border border-gray-100">
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                        {splitMode === "shares" ? "Total" : "Remaining"}
                      </p>
                      <p className="text-base font-bold text-gray-900">
                        {splitMode === "amount" && `${currSymbol}${amt.toFixed(2)}`}
                        {splitMode === "percent" && "100%"}
                        {splitMode === "shares" && `${members.reduce((s, m) => s + (parseFloat(customShares[m.id] || "1") || 0), 0)} shares`}
                        {splitMode === "adjustment" && `${currSymbol}${amt.toFixed(2)}`}
                      </p>
                    </div>
                  </div>
                  <div className="px-4 pb-4 pt-2 shrink-0">
                    <button
                      onClick={() => setShowSplitDetailSheet(false)}
                      className="w-full py-3.5 rounded-2xl bg-[#3D8E62] hover:bg-[#2D7A52] text-white text-sm font-semibold transition-colors shadow-lg shadow-[#3D8E62]/20"
                    >
                      Done
                    </button>
                  </div>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </>
    );
  }

  // ── STEP 3: Summary ────────────────────────────────────────────────────
  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
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
          {/* Header */}
          <div className="flex items-center px-6 py-5 shrink-0 border-b border-gray-100">
            <button onClick={() => setStep(2)} className="w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 transition-colors">
              <ChevronLeft size={18} />
            </button>
            <h3 className="flex-1 text-lg font-bold text-gray-900 tracking-tight text-center">Summary</h3>
            <button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 transition-colors">
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 min-h-0">
            {/* Expense card */}
            <div className="p-5 rounded-2xl bg-[#F0F9F4] border border-[#C3E0D3]">
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1">Expense</p>
              <p className="text-3xl font-bold text-gray-900 tracking-tight tabular-nums">{currSymbol}{amt.toFixed(2)}</p>
              <p className="text-sm font-medium text-gray-700 mt-1">{desc || "Expense"}</p>
              <p className="text-xs text-gray-500 mt-1">
                Paid by {payerName === "you" ? "You" : payerName} · {members.length} people
              </p>
            </div>

            {/* They owe you / You owe */}
            {oweList.length > 0 && (
              <div>
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-3">
                  {oweList[0]?.payerIsMe ? "They owe you" : "You owe"}
                </p>
                <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
                  {oweList.map((person, i) => {
                    const isSettled = settledPersons.includes(person.memberId);
                    const isSettling = settlingPerson === person.memberId;
                    return (
                      <div key={person.memberId} className={`px-4 py-4 ${i < oweList.length - 1 ? "border-b border-gray-50" : ""}`}>
                        <div className="flex items-center gap-3 mb-3">
                          <Avatar
                            initials={person.initials}
                            color={MEMBER_COLORS[i % MEMBER_COLORS.length]}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-900">{person.displayName}</p>
                            <p className="text-xs text-gray-400 mt-0.5">their share</p>
                          </div>
                          <p className="text-lg font-bold text-gray-900 tabular-nums">
                            {currSymbol}{person.amount.toFixed(2)}
                          </p>
                        </div>
                        {person.payerIsMe && (
                          <button
                            onClick={() => handleSettle(person.memberId, person.amount)}
                            disabled={isSettled || isSettling}
                            className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-semibold transition-all ${
                              isSettled
                                ? "border-[#C3E0D3] bg-[#EEF7F2] text-[#3D8E62]"
                                : "border-gray-200 hover:border-[#3D8E62] hover:bg-[#EEF7F2] text-gray-700"
                            }`}
                          >
                            {isSettled ? (
                              <><CheckCircle2 size={14} /> Link copied</>
                            ) : isSettling ? (
                              "Creating link…"
                            ) : (
                              <><Nfc size={14} /> Settle now with Tap to Pay</>
                            )}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
          </div>

          <div className="px-6 pb-6 pt-2 shrink-0">
            <button
              onClick={save}
              disabled={saving}
              className="w-full py-3.5 rounded-2xl bg-[#3D8E62] hover:bg-[#2D7A52] disabled:opacity-50 text-white text-sm font-semibold transition-colors shadow-lg shadow-[#3D8E62]/20"
            >
              {saving ? "Saving…" : "Done"}
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
  p2pHandles,
  groupName,
}: {
  person: { key: string; displayName: string; balance: number; initials: string; color: string };
  onClose: () => void;
  onSuccess: () => void;
  onRequestPayment: () => void;
  recordSettlement: () => Promise<void>;
  p2pHandles?: {
    venmo_username?: string | null;
    cashapp_cashtag?: string | null;
    paypal_username?: string | null;
  };
  groupName?: string;
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
                {direction === "you_owe" &&
                  p2pHandles &&
                  (p2pHandles.venmo_username || p2pHandles.cashapp_cashtag || p2pHandles.paypal_username) &&
                  getP2PDeepLinks(
                    amount,
                    p2pHandles,
                    groupName || `Settlement with ${person.displayName}`
                  ).map((link) => (
                    <a
                      key={link.platform}
                      href={link.webUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full py-3.5 rounded-2xl border-2 border-[#3D8E62] text-[#3D8E62] font-semibold hover:bg-[#EEF7F2] transition-colors text-center block"
                    >
                      {link.label}
                    </a>
                  ))}
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
  const { activity, loading: activityLoading, refetch: refetchActivity } = useRecentActivity(true);

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
  const [editingHandlesMemberId, setEditingHandlesMemberId] = useState<string | null>(null);
  const [handlesDraft, setHandlesDraft] = useState<{ venmo: string; cashapp: string; paypal: string }>({ venmo: "", cashapp: "", paypal: "" });
  const [savingHandles, setSavingHandles] = useState(false);
  const [handlesSaved, setHandlesSaved] = useState<string | null>(null);
  const [settleHandles, setSettleHandles] = useState<{
    venmo_username?: string | null;
    cashapp_cashtag?: string | null;
    paypal_username?: string | null;
  } | undefined>(undefined);

  // Known contacts for quick-add when creating a group
  const [knownContacts, setKnownContacts] = useState<{ displayName: string; email: string | null }[]>([]);
  const [pendingMembers, setPendingMembers] = useState<{ displayName: string; email: string | null }[]>([]);
  const [newMemberInput, setNewMemberInput] = useState("");

  const { detail: groupDetail, loading: groupDetailLoading, refetch: refetchGroupDetail } = useGroupDetail(selectedId);
  const { detail: personDetail, loading: personDetailLoading, refetch: refetchPersonDetail } = usePersonDetail(
    settleTarget?.key ?? expandedPerson ?? selectedPersonKey ?? null
  );

  const showRealUI = true; // Groups don't require bank link — always show

  useEffect(() => {
    if (!selectedId && !selectedPersonKey && showRealUI) refetchSummary();
  }, [selectedId, selectedPersonKey, showRealUI, refetchSummary]);

  useEffect(() => {
    if (showAdd || settleTarget) {
      refetchActivity();
    }
  }, [showAdd, settleTarget, refetchActivity]);

  // Fetch P2P handles for settle target
  useEffect(() => {
    if (!settleTarget) {
      setSettleHandles(undefined);
      return;
    }
    // Find which group(s) this person is in, then fetch members to get handles
    const pd = personDetail;
    if (!pd?.activity?.length) return;
    const groupId = pd.activity[0].groupName;
    const group = summary?.groups?.find((g) => g.name === groupId);
    if (!group) return;
    let cancelled = false;
    fetch(`/api/groups/${group.id}/members`)
      .then((r) => r.ok ? r.json() : [])
      .then((members: Array<{ display_name: string; venmo_username?: string; cashapp_cashtag?: string; paypal_username?: string }>) => {
        if (cancelled) return;
        const match = members.find((m) => m.display_name === settleTarget.displayName);
        if (match) {
          setSettleHandles({
            venmo_username: match.venmo_username || null,
            cashapp_cashtag: match.cashapp_cashtag || null,
            paypal_username: match.paypal_username || null,
          });
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [settleTarget, personDetail, summary?.groups]);

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

  const openCreate = () => {
    setNewGroupName("");
    setNewGroupType("other");
    setCreateError(null);
    setPendingMembers([]);
    setNewMemberInput("");
    setShowCreate(true);
    // Fetch known contacts for quick-add
    fetch("/api/groups/people")
      .then((r) => r.ok ? r.json() : { people: [] })
      .then((d) => {
        const people = Array.isArray(d.people) ? d.people : [];
        setKnownContacts(people.map((p: { displayName: string; email?: string | null }) => ({
          displayName: p.displayName,
          email: p.email ?? null,
        })));
      })
      .catch(() => {});
  };

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
        // Add all pending members to the newly created group
        if (pendingMembers.length > 0) {
          await Promise.all(pendingMembers.map((m) =>
            fetch(`/api/groups/${data.id}/members`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ displayName: m.displayName, email: m.email }),
            })
          ));
        }
        setNewGroupName("");
        setPendingMembers([]);
        setNewMemberInput("");
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

  const toggleEditHandles = (memberId: string, member: { venmo_username?: string | null; cashapp_cashtag?: string | null; paypal_username?: string | null }) => {
    if (editingHandlesMemberId === memberId) {
      setEditingHandlesMemberId(null);
      return;
    }
    setEditingHandlesMemberId(memberId);
    setHandlesDraft({
      venmo: member.venmo_username ?? "",
      cashapp: member.cashapp_cashtag ?? "",
      paypal: member.paypal_username ?? "",
    });
  };

  const saveHandles = async (memberId: string) => {
    if (!selectedId) return;
    setSavingHandles(true);
    try {
      const res = await fetch(`/api/groups/${selectedId}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId,
          venmo_username: handlesDraft.venmo.trim() || null,
          cashapp_cashtag: handlesDraft.cashapp.trim() || null,
          paypal_username: handlesDraft.paypal.trim() || null,
        }),
      });
      if (res.ok) {
        setHandlesSaved(memberId);
        refetchGroupDetail();
        setTimeout(() => setHandlesSaved(null), 2000);
        setEditingHandlesMemberId(null);
      }
    } finally {
      setSavingHandles(false);
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

  // (Bank link gate removed — groups work without a linked bank account)

  // Group detail view
  if (selectedId && groupDetailLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-8 py-8">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-[#3D8E62]/30 border-t-[#3D8E62] rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Loading group...</p>
        </div>
      </div>
    );
  }

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
              {groupDetail.members.map((m, i) => {
                const isEditing = editingHandlesMemberId === m.id;
                const justSaved = handlesSaved === m.id;
                const hasHandles = m.venmo_username || m.cashapp_cashtag || m.paypal_username;
                return (
                  <div key={m.id} className="rounded-xl border border-gray-100 overflow-hidden">
                    <div className="flex items-center gap-2 text-sm px-3 py-2.5">
                      <Avatar initials={m.display_name.slice(0, 2).toUpperCase()} color={MEMBER_COLORS[i % MEMBER_COLORS.length]} size="sm" />
                      <div className="flex-1 min-w-0">
                        <span className="font-medium">{m.display_name}</span>
                        {m.email && <span className="text-gray-500 text-xs ml-1.5">{m.email}</span>}
                        {hasHandles && !isEditing && (
                          <div className="flex gap-2 mt-0.5">
                            {m.venmo_username && <span className="text-[10px] text-gray-400">Venmo: {m.venmo_username}</span>}
                            {m.cashapp_cashtag && <span className="text-[10px] text-gray-400">Cash: {m.cashapp_cashtag}</span>}
                            {m.paypal_username && <span className="text-[10px] text-gray-400">PayPal: {m.paypal_username}</span>}
                          </div>
                        )}
                      </div>
                      {justSaved ? (
                        <span className="flex items-center gap-1 text-xs text-[#3D8E62] font-medium">
                          <CheckCircle2 size={14} /> Saved
                        </span>
                      ) : (
                        <button
                          onClick={() => toggleEditHandles(m.id, m)}
                          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors px-1.5 py-1 rounded-md hover:bg-gray-50"
                        >
                          {isEditing ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          <span>{isEditing ? "Close" : "Payment handles"}</span>
                        </button>
                      )}
                    </div>
                    {isEditing && (
                      <div className="px-3 pb-3 pt-1 border-t border-gray-100 bg-gray-50/50">
                        <div className="space-y-2">
                          <div>
                            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Venmo</label>
                            <input
                              value={handlesDraft.venmo}
                              onChange={(e) => setHandlesDraft((d) => ({ ...d, venmo: e.target.value }))}
                              placeholder="@username"
                              className="w-full mt-0.5 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/20 focus:border-[#3D8E62] bg-white"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Cash App</label>
                            <input
                              value={handlesDraft.cashapp}
                              onChange={(e) => setHandlesDraft((d) => ({ ...d, cashapp: e.target.value }))}
                              placeholder="$cashtag"
                              className="w-full mt-0.5 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/20 focus:border-[#3D8E62] bg-white"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">PayPal</label>
                            <input
                              value={handlesDraft.paypal}
                              onChange={(e) => setHandlesDraft((d) => ({ ...d, paypal: e.target.value }))}
                              placeholder="username"
                              className="w-full mt-0.5 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/20 focus:border-[#3D8E62] bg-white"
                            />
                          </div>
                        </div>
                        <button
                          onClick={() => saveHandles(m.id)}
                          disabled={savingHandles}
                          className="mt-3 w-full py-2 rounded-lg bg-[#3D8E62] hover:bg-[#2D7A52] disabled:opacity-50 text-white text-sm font-medium transition-colors"
                        >
                          {savingHandles ? "Saving\u2026" : "Save handles"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
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
      emoji: GROUP_EMOJI[g.groupType ?? "other"] ?? "👥",
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
              disabled={loading}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-[#3D8E62] hover:bg-[#2D7A52] text-white px-5 py-3.5 rounded-2xl text-sm font-semibold transition-all shadow-lg shadow-[#3D8E62]/25 hover:shadow-[#3D8E62]/30 hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Plus size={18} strokeWidth={2.5} />
              Add expense
            </button>
            <button
              onClick={() => openCreate()}
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

            {/* Members */}
            <div>
              <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2 block">Members</label>

              {/* Known contacts quick-add */}
              {knownContacts.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs text-gray-400 mb-2">From your contacts</p>
                  <div className="flex flex-wrap gap-2">
                    {knownContacts.map((c) => {
                      const already = pendingMembers.some(
                        (m) => m.displayName === c.displayName && m.email === c.email
                      );
                      return (
                        <button
                          key={c.email ?? c.displayName}
                          onClick={() => {
                            if (already) {
                              setPendingMembers((prev) =>
                                prev.filter((m) => !(m.displayName === c.displayName && m.email === c.email))
                              );
                            } else {
                              setPendingMembers((prev) => [...prev, { displayName: c.displayName, email: c.email }]);
                            }
                          }}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-all ${
                            already
                              ? "border-[#3D8E62] bg-[#EEF7F2] text-[#2D7A52] font-medium"
                              : "border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                          }`}
                        >
                          <span className="w-5 h-5 rounded-full bg-[#3D8E62]/10 flex items-center justify-center text-[10px] font-bold text-[#3D8E62]">
                            {c.displayName[0]?.toUpperCase()}
                          </span>
                          {c.displayName}
                          {already && <CheckCircle2 size={12} className="text-[#3D8E62]" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Manual entry */}
              <div className="flex gap-2">
                <input
                  value={newMemberInput}
                  onChange={(e) => setNewMemberInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newMemberInput.trim()) {
                      setPendingMembers((prev) => [...prev, { displayName: newMemberInput.trim(), email: null }]);
                      setNewMemberInput("");
                    }
                  }}
                  placeholder="Add someone new…"
                  className="flex-1 px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/30"
                />
                <button
                  onClick={() => {
                    if (!newMemberInput.trim()) return;
                    setPendingMembers((prev) => [...prev, { displayName: newMemberInput.trim(), email: null }]);
                    setNewMemberInput("");
                  }}
                  disabled={!newMemberInput.trim()}
                  className="px-3 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium disabled:opacity-40 transition-colors"
                >
                  <Plus size={16} />
                </button>
              </div>

              {/* Pending members list */}
              {pendingMembers.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {pendingMembers.map((m, i) => (
                    <span
                      key={i}
                      className="flex items-center gap-1 bg-[#EEF7F2] text-[#2D7A52] text-xs px-2.5 py-1 rounded-full border border-[#C3E0D3]"
                    >
                      {m.displayName}
                      <button
                        onClick={() => setPendingMembers((prev) => prev.filter((_, j) => j !== i))}
                        className="ml-0.5 hover:text-red-500 transition-colors"
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={createGroup}
                disabled={!newGroupName.trim() || creating}
                className="flex-1 py-3 rounded-xl bg-[#3D8E62] text-white text-sm font-semibold disabled:opacity-50 hover:bg-[#2D7A52] transition-colors"
              >
                {creating ? "Creating…" : `Create${pendingMembers.length > 0 ? ` with ${pendingMembers.length} member${pendingMembers.length > 1 ? "s" : ""}` : ""}`}
              </button>
              <button
                onClick={() => { setShowCreate(false); setNewGroupName(""); setCreateError(null); setPendingMembers([]); setNewMemberInput(""); }}
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

      {!linked && (
        <div className="flex items-center gap-3 bg-[#EEF7F2] border border-[#C3E0D3] rounded-xl px-4 py-3 mb-4 text-sm">
          <span className="text-[#3D8E62]">💡</span>
          <span className="text-[#2D5A44] flex-1">Connect your bank to attach real transactions when splitting expenses.</span>
          <a href="/connect" className="text-[#3D8E62] font-medium hover:underline shrink-0">Connect →</a>
        </div>
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
                    onClick={() => openCreate()}
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
            summaryGroups={summary?.groups ?? []}
            summaryFriends={summary?.friends ?? []}
            selectedGroupId={null}
            selectedPersonKey={null}
          />
        )}
        {settleTarget && (
          <SettleModal
            person={settleTarget}
            p2pHandles={settleHandles}
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
                    {person.direction === "you_owe" && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onSettleUp(); }}
                        className="text-xs font-semibold text-[#3D8E62] hover:underline"
                      >
                        Pay →
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

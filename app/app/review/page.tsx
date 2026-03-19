"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform, PanInfo } from "motion/react";
import { Check, X, Users, Share2, ChevronLeft, ChevronRight, RefreshCw, Inbox } from "lucide-react";
import { useTransactions } from "@/hooks/useTransactions";
import { useCurrency } from "@/hooks/useCurrency";
import { AmountDisplay, MerchantLogo } from "@/components/transaction-ui";
import { formatCurrencyAbs } from "@/lib/currency";
import type { UITransaction } from "@/lib/transaction-types";

type SplitMode = "person" | "group";

function ReviewQueue() {
  const { transactions, loading } = useTransactions();
  const { currencyCode } = useCurrency();

  const [reviewedIds, setReviewedIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const saved = localStorage.getItem("coconut:reviewed-tx");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });

  const [currentIndex, setCurrentIndex] = useState(0);
  const [showSplitFlow, setShowSplitFlow] = useState(false);
  const [direction, setDirection] = useState<"left" | "right" | null>(null);

  // Split flow state
  const [splitMode, setSplitMode] = useState<SplitMode>("person");
  const [people, setPeople] = useState<{ displayName: string; groupId: string; groupName: string; memberId: string; memberCount: number }[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<{ groupId: string; memberId: string; displayName: string } | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [members, setMembers] = useState<{ id: string; display_name: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [newPersonName, setNewPersonName] = useState("");
  const [addingNewPerson, setAddingNewPerson] = useState(false);

  const queue = transactions.filter(
    (tx) => !reviewedIds.has(tx.id) && tx.amount < 0 && !tx.isPending
  );

  const currentTx = queue[currentIndex] || null;

  const saveReviewed = useCallback((ids: Set<string>) => {
    setReviewedIds(ids);
    try {
      const arr = [...ids];
      if (arr.length > 500) arr.splice(0, arr.length - 500);
      localStorage.setItem("coconut:reviewed-tx", JSON.stringify(arr));
    } catch { /* quota */ }
  }, []);

  const markReviewed = useCallback((txId: string) => {
    const next = new Set(reviewedIds);
    next.add(txId);
    saveReviewed(next);
  }, [reviewedIds, saveReviewed]);

  const handleSkip = useCallback(() => {
    if (!currentTx) return;
    setDirection("left");
    setTimeout(() => {
      markReviewed(currentTx.id);
      setDirection(null);
    }, 200);
  }, [currentTx, markReviewed]);

  const handleSplit = useCallback(() => {
    if (!currentTx) return;
    setShowSplitFlow(true);
    loadPeopleAndGroups();
  }, [currentTx]);

  // Swipe gesture
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 0, 200], [-8, 0, 8]);
  const skipOpacity = useTransform(x, [-150, -50, 0], [1, 0.5, 0]);
  const splitOpacity = useTransform(x, [0, 50, 150], [0, 0.5, 1]);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -100) {
      handleSkip();
    } else if (info.offset.x > 100) {
      handleSplit();
    }
  };

  // Split flow functions (reused from TransactionDrawer)
  const loadPeopleAndGroups = async () => {
    const res = await fetch("/api/groups/people");
    if (res.ok) {
      const data = await res.json();
      setPeople(Array.isArray(data.people) ? data.people : []);
      setGroups(Array.isArray(data.groups) ? data.groups : []);
    }
  };

  const loadGroupMembers = async (groupId: string) => {
    setMembers([]);
    const res = await fetch(`/api/groups/${groupId}`);
    if (res.ok) {
      const data = await res.json();
      setMembers(Array.isArray(data.members) ? data.members : []);
    }
  };

  const createPersonAndGroup = async (): Promise<string | null> => {
    if (!newPersonName.trim()) return null;
    setAddingNewPerson(true);
    try {
      const createRes = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newPersonName.trim(), ownerDisplayName: "You" }),
      });
      const group = await createRes.json();
      if (!createRes.ok || !group.id) return null;
      const addRes = await fetch(`/api/groups/${group.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: newPersonName.trim() }),
      });
      if (!addRes.ok) return null;
      const addedMember = await addRes.json().catch(() => null);
      setNewPersonName("");
      await loadPeopleAndGroups();
      if (addedMember?.id) {
        setSelectedPerson({ groupId: group.id, memberId: addedMember.id, displayName: newPersonName.trim() });
      }
      return group.id;
    } finally {
      setAddingNewPerson(false);
    }
  };

  const effectiveGroupId = splitMode === "person" && selectedPerson ? selectedPerson.groupId : selectedGroupId;
  const canSubmit = currentTx?.dbId && effectiveGroupId && members.length > 0;

  const handleAddToShared = async () => {
    if (!canSubmit || !currentTx) return;
    const groupId = effectiveGroupId!;
    const totalAmount = Math.abs(currentTx.amount);
    const totalCents = Math.round(totalAmount * 100);
    const baseCents = Math.floor(totalCents / members.length);
    const remainderCents = totalCents - baseCents * members.length;
    const shares = members.map((m, i) => ({
      memberId: m.id,
      amount: (baseCents + (i < remainderCents ? 1 : 0)) / 100,
    }));
    setSubmitting(true);
    try {
      const res = await fetch("/api/split-transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupId,
          transactionId: currentTx.dbId,
          shares,
        }),
      });
      if (res.ok) {
        setShowSplitFlow(false);
        resetSplitState();
        setDirection("right");
        setTimeout(() => {
          markReviewed(currentTx.id);
          setDirection(null);
        }, 200);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const resetSplitState = () => {
    setSplitMode("person");
    setSelectedPerson(null);
    setSelectedGroupId(null);
    setMembers([]);
    setNewPersonName("");
  };

  const handleCloseSplit = () => {
    setShowSplitFlow(false);
    resetSplitState();
  };

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (showSplitFlow) return;
      if (e.key === "ArrowLeft" || e.key === "Escape") handleSkip();
      if (e.key === "ArrowRight" || e.key === "Enter") handleSplit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSkip, handleSplit, showSplitFlow]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-7 h-7 border-2 border-[#3D8E62]/30 border-t-[#3D8E62] rounded-full animate-spin" />
      </div>
    );
  }

  if (queue.length === 0) {
    return (
      <div className="max-w-lg mx-auto px-6 py-16 text-center">
        <div className="w-16 h-16 rounded-2xl bg-[#EEF7F2] flex items-center justify-center mx-auto mb-4">
          <Inbox size={28} className="text-[#3D8E62]" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">All caught up</h2>
        <p className="text-sm text-gray-500 mb-6">No transactions to review right now. New ones will appear here as they come in.</p>
        <button
          onClick={() => {
            saveReviewed(new Set());
            setCurrentIndex(0);
          }}
          className="text-sm text-[#3D8E62] font-medium hover:underline"
        >
          Reset and review all again
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Review</h1>
        <p className="text-sm text-gray-500 mt-1">{queue.length} transaction{queue.length === 1 ? "" : "s"} to review</p>
      </div>

      {/* Card stack */}
      <div className="relative h-[340px] mb-6">
        <AnimatePresence mode="popLayout">
          {currentTx && (
            <motion.div
              key={currentTx.id}
              style={{ x, rotate }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.7}
              onDragEnd={handleDragEnd}
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1, x: direction === "left" ? -300 : direction === "right" ? 300 : 0 }}
              exit={{ scale: 0.9, opacity: 0, x: direction === "left" ? -300 : direction === "right" ? 300 : 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="absolute inset-0 cursor-grab active:cursor-grabbing"
            >
              <div className="bg-white rounded-2xl border border-gray-100 shadow-lg p-6 h-full flex flex-col">
                {/* Swipe hints */}
                <div className="flex justify-between mb-4">
                  <motion.div style={{ opacity: skipOpacity }} className="flex items-center gap-1.5 text-gray-400 text-xs font-medium">
                    <X size={14} />
                    Skip
                  </motion.div>
                  <motion.div style={{ opacity: splitOpacity }} className="flex items-center gap-1.5 text-[#3D8E62] text-xs font-medium">
                    Split
                    <Share2 size={14} />
                  </motion.div>
                </div>

                {/* Transaction */}
                <div className="flex-1 flex flex-col items-center justify-center text-center">
                  <MerchantLogo name={currentTx.merchant} color={currentTx.merchantColor} size="lg" />
                  <h2 className="text-lg font-bold text-gray-900 mt-4">{currentTx.merchant}</h2>
                  <div className="text-3xl font-bold mt-2">
                    <AmountDisplay amount={currentTx.amount} currencyCode={currencyCode} />
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <span className={`px-2.5 py-0.5 rounded-full text-xs ${currentTx.categoryColor}`}>{currentTx.category}</span>
                    <span className="text-sm text-gray-400">{currentTx.dateStr}</span>
                  </div>
                  {currentTx.location && (
                    <p className="text-xs text-gray-400 mt-2">{currentTx.location}</p>
                  )}
                  {currentTx.splitWith && (
                    <div className="mt-3 flex items-center gap-1.5 text-xs text-[#3D8E62] bg-[#EEF7F2] px-3 py-1.5 rounded-full">
                      <Users size={11} />
                      Previously split with {currentTx.splitWith}
                    </div>
                  )}
                </div>

                {/* Counter */}
                <div className="text-center text-xs text-gray-400 mt-4">
                  {queue.indexOf(currentTx) + 1} of {queue.length}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Background card for depth */}
        {queue.length > 1 && (
          <div className="absolute inset-0 bg-white rounded-2xl border border-gray-100 shadow-sm scale-[0.95] translate-y-2 -z-10" />
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center justify-center gap-6">
        <button
          onClick={handleSkip}
          className="w-16 h-16 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors group"
          title="Skip (←)"
        >
          <X size={24} className="text-gray-500 group-hover:text-gray-700" />
        </button>
        <button
          onClick={handleSplit}
          className="w-20 h-20 rounded-full bg-[#3D8E62] hover:bg-[#2D7A52] flex items-center justify-center transition-colors shadow-lg shadow-[#3D8E62]/20 group"
          title="Split (→)"
        >
          <Share2 size={28} className="text-white" />
        </button>
      </div>
      <div className="flex items-center justify-center gap-12 mt-3">
        <span className="text-xs text-gray-400">Skip</span>
        <span className="text-xs text-[#3D8E62] font-medium">Split</span>
      </div>

      {/* Keyboard hint */}
      <p className="text-center text-xs text-gray-300 mt-6">← arrow to skip · → arrow to split</p>

      {/* Split flow modal */}
      <AnimatePresence>
        {showSplitFlow && currentTx && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 z-50 flex items-end sm:items-center justify-center p-4"
            onClick={handleCloseSplit}
          >
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-gray-100">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold">Split this expense</h3>
                  <button
                    onClick={handleCloseSplit}
                    aria-label="Close"
                    className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100"
                  >
                    <X size={16} />
                  </button>
                </div>
                <div className="flex items-center gap-3 mt-3">
                  <MerchantLogo name={currentTx.merchant} color={currentTx.merchantColor} />
                  <div>
                    <div className="text-sm font-medium text-gray-900">{currentTx.merchant}</div>
                    <div className="text-sm text-gray-500">{formatCurrencyAbs(currentTx.amount, currencyCode)} · {currentTx.dateStr}</div>
                  </div>
                </div>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <div className="flex gap-2 mb-2">
                    <button
                      type="button"
                      onClick={() => { setSplitMode("person"); setSelectedPerson(null); setSelectedGroupId(null); setMembers([]); }}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${splitMode === "person" ? "bg-[#3D8E62] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                    >
                      Person
                    </button>
                    <button
                      type="button"
                      onClick={() => { setSplitMode("group"); setSelectedPerson(null); setSelectedGroupId(null); setMembers([]); }}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${splitMode === "group" ? "bg-[#3D8E62] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                    >
                      Group
                    </button>
                  </div>

                  {splitMode === "person" ? (
                    <>
                      <label className="text-sm font-medium text-gray-700 block mb-2">Split with</label>
                      <select
                        value={selectedPerson ? `${selectedPerson.groupId}-${selectedPerson.memberId}` : ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (!val) { setSelectedPerson(null); setMembers([]); return; }
                          const p = people.find((x) => `${x.groupId}-${x.memberId}` === val);
                          if (p) {
                            setSelectedPerson({ groupId: p.groupId, memberId: p.memberId, displayName: p.displayName });
                            loadGroupMembers(p.groupId);
                          }
                        }}
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/20 focus:border-[#3D8E62]"
                      >
                        <option value="">Choose a person...</option>
                        {people.map((p) => (
                          <option key={`${p.groupId}-${p.memberId}`} value={`${p.groupId}-${p.memberId}`}>
                            {p.displayName}{p.memberCount > 2 ? ` (${p.groupName})` : ""}
                          </option>
                        ))}
                      </select>
                      <div className="mt-2 flex gap-2">
                        <input
                          value={newPersonName}
                          onChange={(e) => setNewPersonName(e.target.value)}
                          placeholder="Or add new person..."
                          aria-label="New person name"
                          className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            const gid = await createPersonAndGroup();
                            if (gid) loadGroupMembers(gid);
                          }}
                          disabled={!newPersonName.trim() || addingNewPerson}
                          className="px-3 py-2 rounded-lg bg-gray-100 text-sm font-medium hover:bg-gray-200 disabled:opacity-50"
                        >
                          {addingNewPerson ? "Adding…" : "Add"}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <label className="text-sm font-medium text-gray-700 block mb-2">Select group</label>
                      <select
                        value={selectedGroupId ?? ""}
                        onChange={(e) => {
                          const id = e.target.value || null;
                          setSelectedGroupId(id);
                          if (id) loadGroupMembers(id);
                          else setMembers([]);
                        }}
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/20 focus:border-[#3D8E62]"
                      >
                        <option value="">Choose a group...</option>
                        {groups.map((g) => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                    </>
                  )}

                  {splitMode === "person" && people.length === 0 && !newPersonName && (
                    <p className="mt-1.5 text-xs text-gray-500">Add a person above or create a group from Shared first.</p>
                  )}
                  {splitMode === "group" && groups.length === 0 && (
                    <p className="mt-1.5 text-xs text-gray-500">No groups yet. Create one from the Shared page.</p>
                  )}
                </div>

                {members.length > 0 && (
                  <div className="rounded-xl bg-gray-50 p-4">
                    <div className="text-sm font-medium text-gray-700 mb-2">Equal split</div>
                    <div className="text-xs text-gray-500 mb-2">
                      {formatCurrencyAbs(currentTx.amount, currencyCode)} ÷ {members.length} ≈{" "}
                      {formatCurrencyAbs(Math.floor(Math.round(Math.abs(currentTx.amount) * 100) / members.length) / 100, currencyCode)} each
                    </div>
                    <ul className="space-y-1">
                      {members.map((m) => (
                        <li key={m.id} className="text-sm text-gray-600 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-[#3D8E62]" />
                          {m.display_name}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="px-6 py-4 border-t border-gray-100 flex gap-2">
                <button
                  onClick={handleCloseSplit}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddToShared}
                  disabled={!canSubmit || submitting}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-[#3D8E62] rounded-xl hover:bg-[#2D7A52] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? "Adding…" : "Split & next"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function ReviewPage() {
  return <ReviewQueue />;
}

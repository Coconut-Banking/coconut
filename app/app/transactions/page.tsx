"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Search,
  Filter,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Users,
  X,
  MapPin,
  StickyNote,
  Share2,
  Zap,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useTransactions } from "@/hooks/useTransactions";
import { useAccounts } from "@/hooks/useAccounts";
import { useCurrency, useCompactView } from "@/hooks/useCurrency";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useHiddenAccounts } from "@/hooks/useHiddenAccounts";
import { useNLSearch } from "@/hooks/useNLSearch";
import type { UITransaction } from "@/lib/transaction-types";
import { AmountDisplay, MerchantLogo } from "@/components/transaction-ui";
import { formatCurrencyAbs } from "@/lib/currency";

// Display labels for known Plaid primary categories
function isInvestmentAccount(acc: { type?: string; subtype?: string; name?: string }): boolean {
  const t = (acc.type ?? "").toLowerCase();
  const s = (acc.subtype ?? "").toLowerCase();
  const n = (acc.name ?? "").toLowerCase();
  return (
    t === "investment" ||
    /\b(brokerage|tfsa|ira|401k|403b|457b|529|trust)\b/.test(s) ||
    /\b(tfsa|non-registered|crypto|brokerage|investment)\b/.test(n)
  );
}

const CATEGORY_LABEL: Record<string, string> = {
  "FOOD AND DRINK": "Food & Drink",
  "GROCERIES": "Groceries",
  "COFFEE": "Coffee",
  "FAST FOOD": "Fast Food",
  "ALCOHOL": "Alcohol",
  "ENTERTAINMENT": "Entertainment",
  "GAMBLING": "Gambling",
  "STREAMING": "Streaming",
  "TRANSPORTATION": "Transport",
  "GAS AND FUEL": "Gas & Fuel",
  "PARKING": "Parking",
  "RIDESHARE": "Rideshare",
  "TRAVEL": "Travel",
  "SHOPPING": "Shopping",
  "CLOTHING": "Clothing",
  "ELECTRONICS": "Electronics",
  "GENERAL MERCHANDISE": "Shopping",
  "GENERAL SERVICES": "Services",
  "PERSONAL CARE": "Personal Care",
  "HAIRCUT": "Haircut",
  "FITNESS": "Fitness",
  "HEALTHCARE": "Health",
  "CANNABIS": "Cannabis",
  "RENT AND UTILITIES": "Utilities",
  "HOME IMPROVEMENT": "Home",
  "SUBSCRIPTIONS": "Subscriptions",
  "EDUCATION": "Education",
  "LOAN PAYMENTS": "Loans",
  "INCOME": "Income",
  "TRANSFER IN": "Transfer In",
  "TRANSFER OUT": "Transfer Out",
  "OTHER": "Other",
};

type SplitMode = "person" | "group";

function TransactionDrawer({ tx, onClose, currencyCode }: { tx: UITransaction; onClose: () => void; currencyCode?: string }) {
  const [note, setNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [showAddToShared, setShowAddToShared] = useState(false);
  const [splitMode, setSplitMode] = useState<SplitMode>("person");
  const [people, setPeople] = useState<{ displayName: string; groupId: string; groupName: string; memberId: string; memberCount: number }[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<{ groupId: string; memberId: string; displayName: string } | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [members, setMembers] = useState<{ id: string; display_name: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [newPersonName, setNewPersonName] = useState("");
  const [addingNewPerson, setAddingNewPerson] = useState(false);
  const [markingSubscription, setMarkingSubscription] = useState(false);

  const handleMarkAsSubscription = async () => {
    if (!tx.dbId) return;
    setMarkingSubscription(true);
    try {
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId: tx.dbId }),
      });
      if (res.ok) {
        onClose();
      } else {
        alert("Failed to mark as subscription. Please try again.");
      }
    } finally {
      setMarkingSubscription(false);
    }
  };

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
  const canSubmit = tx.dbId && effectiveGroupId && members.length > 0;

  const handleAddToShared = async () => {
    if (!canSubmit) return;
    const groupId = effectiveGroupId!;
    const totalAmount = Math.abs(tx.amount);
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
          transactionId: tx.dbId,
          shares,
        }),
      });
      if (res.ok) {
        setShowAddToShared(false);
        setSelectedPerson(null);
        setSelectedGroupId(null);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/10 z-40"
      />
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
        className="fixed right-0 top-0 bottom-0 w-full sm:w-96 bg-white border-l border-gray-200 z-50 flex flex-col shadow-xl"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">Transaction details</h3>
          <button
            onClick={onClose}
            aria-label="Close transaction details"
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
          >
            <X size={15} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-6 border-b border-gray-100">
            <div className="flex items-start gap-4">
              <MerchantLogo name={tx.merchant} color={tx.merchantColor} size="lg" />
              <div className="flex-1">
                <h2 className="text-lg font-bold text-gray-900">{tx.merchant}</h2>
                <div className="text-2xl font-bold mt-1">
                  <AmountDisplay
                  amount={tx.amount}
                  className="text-2xl"
                  currencyCode={currencyCode}
                  isoCurrencyCode={tx.isoCurrencyCode}
                  category={tx.category}
                  merchant={tx.merchant}
                  rawDescription={tx.rawDescription}
                />
                </div>
                <div className="text-sm text-gray-500 mt-0.5">{tx.dateStr}</div>
              </div>
            </div>
          </div>
          <div className="px-6 py-4 space-y-3 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Category</span>
              <span className={`text-xs px-2.5 py-1 rounded-full ${tx.categoryColor}`}>{tx.category}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Raw description</span>
              <span className="text-xs text-gray-400 font-mono max-w-44 text-right truncate">{tx.rawDescription}</span>
            </div>
            {tx.location && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Location</span>
                <div className="flex items-center gap-1 text-sm text-gray-700">
                  <MapPin size={12} className="text-gray-400" />
                  {tx.location}
                </div>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Recurring</span>
              <div className="flex items-center gap-1.5 text-sm">
                {tx.isRecurring ? (
                  <span className="flex items-center gap-1 text-purple-600 text-xs">
                    <RefreshCw size={11} /> Monthly
                  </span>
                ) : (
                  <span className="text-gray-400 text-xs">No</span>
                )}
              </div>
            </div>
            {tx.hasSplitSuggestion && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Split suggestion</span>
                <span className="flex items-center gap-1 text-[#3D8E62] text-xs bg-[#EEF7F2] px-2.5 py-1 rounded-full">
                  <Users size={11} /> With {tx.splitWith}
                </span>
              </div>
            )}
          </div>
          {tx.p2pCounterparty && (
            <div className="px-6 py-4 space-y-3 border-b border-gray-100">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Payment Details</h4>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Platform</span>
                <span className="text-sm text-gray-700">{tx.p2pPlatform === "venmo" ? "Venmo" : tx.p2pPlatform === "cashapp" ? "Cash App" : "PayPal"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">{tx.amount < 0 ? "Sent to" : "Received from"}</span>
                <span className="text-sm text-gray-700 font-medium">{tx.p2pCounterparty}</span>
              </div>
              {tx.p2pNote && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Note</span>
                  <span className="text-sm text-gray-700 max-w-44 text-right truncate">{tx.p2pNote}</span>
                </div>
              )}
            </div>
          )}
          {tx.location && (
            <div className="mx-6 my-4 rounded-xl overflow-hidden border border-gray-100 h-28 bg-gradient-to-br from-[#EEF7F2] to-[#E8F0EC] flex items-center justify-center">
              <div className="text-center">
                <MapPin size={20} className="text-[#3D8E62] mx-auto mb-1" />
                <div className="text-xs text-gray-500">{tx.location}</div>
              </div>
            </div>
          )}
          <div className="px-6 py-4">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Zap size={12} className="text-[#3D8E62]" />
              Smart Actions
            </h4>
            <div className="space-y-2">
              {tx.hasSplitSuggestion && (
                <button
                  onClick={async () => {
                    setShowAddToShared(true);
                    await loadPeopleAndGroups();
                    const match = people.find((p) => p.displayName === tx.splitWith);
                    if (match) {
                      setSelectedPerson({ groupId: match.groupId, memberId: match.memberId, displayName: match.displayName });
                      loadGroupMembers(match.groupId);
                    }
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-[#C3E0D3] bg-[#EEF7F2] hover:bg-[#E0F2EA] text-[#2D7A52] transition-colors text-left"
                >
                  <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shrink-0">
                    <Users size={15} className="text-[#3D8E62]" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">Split with {tx.splitWith}</div>
                    <div className="text-xs opacity-70">You&apos;ve split with them before</div>
                  </div>
                </button>
              )}
              {tx.dbId && (
                <button
                  onClick={() => {
                    setShowAddToShared(true);
                    loadPeopleAndGroups();
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-[#C3E0D3] bg-[#EEF7F2] hover:bg-[#E0F2EA] text-[#2D7A52] transition-colors text-left"
                >
                  <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shrink-0">
                    <Share2 size={15} className="text-[#3D8E62]" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">Add to shared</div>
                    <div className="text-xs opacity-70">Split with a person or group</div>
                  </div>
                </button>
              )}
              {tx.dbId && (
                <button
                  onClick={handleMarkAsSubscription}
                  disabled={markingSubscription}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-[#C3E0D3] bg-[#EEF7F2] hover:bg-[#E0F2EA] text-[#2D7A52] transition-colors text-left disabled:opacity-60"
                >
                  <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shrink-0">
                    <RefreshCw size={15} className={markingSubscription ? "animate-spin" : "text-[#3D8E62]"} />
                  </div>
                  <div>
                    <div className="text-sm font-medium">Mark as subscription</div>
                    <div className="text-xs opacity-70">Add to your subscriptions list</div>
                  </div>
                </button>
              )}
              <button
                onClick={() => setAddingNote(!addingNote)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-100 hover:bg-gray-50 text-gray-700 transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center shrink-0">
                  <StickyNote size={15} className="text-gray-500" />
                </div>
                <div>
                  <div className="text-sm font-medium">Add note</div>
                  <div className="text-xs text-gray-400">Attach a private memo</div>
                </div>
              </button>
              {addingNote && (
                <div className="ml-11">
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Write a note..."
                    aria-label="Transaction note"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/20 focus:border-[#3D8E62]"
                    rows={3}
                    autoFocus
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </motion.div>

      {/* Add to Shared modal */}
      <AnimatePresence>
        {showAddToShared && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 z-[60] flex items-end sm:items-center justify-center p-4"
            onClick={() => setShowAddToShared(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-base font-semibold">Add to shared</h3>
                <button
                  onClick={() => setShowAddToShared(false)}
                  aria-label="Close split modal"
                  className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <div className="flex gap-2 mb-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSplitMode("person");
                        setSelectedPerson(null);
                        setSelectedGroupId(null);
                        setMembers([]);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${splitMode === "person" ? "bg-[#3D8E62] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                    >
                      Person
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSplitMode("group");
                        setSelectedPerson(null);
                        setSelectedGroupId(null);
                        setMembers([]);
                      }}
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
                          if (!val) {
                            setSelectedPerson(null);
                            setMembers([]);
                            return;
                          }
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
                            if (gid) {
                              loadGroupMembers(gid);
                            }
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
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                  {splitMode === "person" && people.length === 0 && !newPersonName && (
                    <p className="mt-1.5 text-xs text-gray-500">
                      Add a person above or create a group from Shared first.
                    </p>
                  )}
                  {splitMode === "group" && groups.length === 0 && (
                    <p className="mt-1.5 text-xs text-gray-500">
                      No groups yet. Create one from the Shared page or add a person above.
                    </p>
                  )}
                </div>
                {members.length > 0 && (
                  <div className="rounded-xl bg-gray-50 p-4">
                    <div className="text-sm font-medium text-gray-700 mb-2">Equal split</div>
                    <div className="text-xs text-gray-500 mb-2">
                      {formatCurrencyAbs(tx.amount, currencyCode)} ÷ {members.length} ≈{" "}
                      {formatCurrencyAbs(Math.floor(Math.round(Math.abs(tx.amount) * 100) / members.length) / 100, currencyCode)} each
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
                  onClick={() => setShowAddToShared(false)}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddToShared}
                  disabled={!canSubmit || submitting}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-[#3D8E62] rounded-xl hover:bg-[#2D7A52] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? "Adding…" : "Add to group"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// Single transaction row (no inline Pending tag — status comes from section header)
function TxRow({
  tx,
  index,
  expandedId,
  setExpandedId,
  onSelect,
  currencyCode,
  compactView,
}: {
  tx: UITransaction;
  index: number;
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
  onSelect: () => void;
  currencyCode?: string;
  compactView?: boolean;
}) {
  return (
    <div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: index * 0.03 }}
        className={`flex items-center gap-4 hover:bg-gray-50 transition-colors cursor-pointer border-b border-gray-50 last:border-b-0 ${compactView ? "px-4 py-2" : "px-5 py-3.5"}`}
        onClick={onSelect}
      >
        <MerchantLogo name={tx.merchant} color={tx.merchantColor} />
        <div className="flex-1 min-w-0">
          <div className={`flex items-center gap-2 ${compactView ? "mb-0" : "mb-0.5"}`}>
            <span className={`font-medium text-gray-900 ${compactView ? "text-xs" : "text-sm"}`}>{tx.merchant}</span>
            {tx.isRecurring && <RefreshCw size={11} className="text-gray-300" />}
            {tx.hasSplitSuggestion && (
              <div className="flex items-center gap-1 bg-[#EEF7F2] text-[#3D8E62] text-xs px-2 py-0.5 rounded-full">
                <Users size={9} />
                <span>Split</span>
              </div>
            )}
            {tx.p2pCounterparty && (
              <div className="flex items-center gap-1 bg-blue-50 text-blue-600 text-xs px-2 py-0.5 rounded-full">
                <span>{tx.p2pPlatform === "venmo" ? "Venmo" : tx.p2pPlatform === "cashapp" ? "Cash App" : "PayPal"} · {tx.p2pCounterparty}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded-full ${tx.categoryColor} ${compactView ? "text-[10px]" : "text-xs"}`}>{tx.category}</span>
            <span className={`text-gray-400 ${compactView ? "text-[10px]" : "text-xs"}`}>{tx.dateStr}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <AmountDisplay
            amount={tx.amount}
            className="text-sm"
            currencyCode={currencyCode}
            isoCurrencyCode={tx.isoCurrencyCode}
            category={tx.category}
            merchant={tx.merchant}
            rawDescription={tx.rawDescription}
          />
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpandedId(expandedId === tx.id ? null : tx.id);
            }}
            aria-label={expandedId === tx.id ? "Collapse details" : "Expand details"}
            className="text-gray-400 hover:text-gray-600 transition-colors p-1"
          >
            {expandedId === tx.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
      </motion.div>
      <AnimatePresence>
        {expandedId === tx.id && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="bg-gray-50 border-b border-gray-100 px-5 py-3 ml-16 grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-gray-400 mb-0.5">Raw description</div>
                <div className="text-xs text-gray-600 font-mono">{tx.rawDescription}</div>
              </div>
              {tx.location && (
                <div>
                  <div className="text-xs text-gray-400 mb-0.5">Location</div>
                  <div className="text-xs text-gray-600 flex items-center gap-1">
                    <MapPin size={10} className="text-gray-400" />
                    {tx.location}
                  </div>
                </div>
              )}
              <div>
                <div className="text-xs text-gray-400 mb-0.5">Status</div>
                <div className="text-xs text-gray-600">
                  {tx.isPending ? "Pending" : "Posted"}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-0.5">Recurring</div>
                <div className="text-xs text-gray-600">
                  {tx.isRecurring ? "Monthly subscription" : "One-time charge"}
                </div>
              </div>
              {tx.hasSplitSuggestion && (
                <div>
                  <div className="text-xs text-gray-400 mb-0.5">Split suggestion</div>
                  <div className="text-xs text-[#3D8E62] font-medium">
                    Split with {tx.splitWith} — {formatCurrencyAbs(Math.round(Math.round(Math.abs(tx.amount) * 100) / 2) / 100, currencyCode)} each
                  </div>
                </div>
              )}
              {tx.p2pCounterparty && (
                <div>
                  <div className="text-xs text-gray-400 mb-0.5">{tx.p2pPlatform === "venmo" ? "Venmo" : tx.p2pPlatform === "cashapp" ? "Cash App" : "PayPal"}</div>
                  <div className="text-xs text-gray-600">
                    {tx.amount < 0 ? "To" : "From"} {tx.p2pCounterparty}{tx.p2pNote ? ` · ${tx.p2pNote}` : ""}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Real-time client-side filter: match query against merchant, category, description, date, amount (no LLM)
function filterTransactionsByQuery<T extends UITransaction>(list: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((tx) => {
    const merchant = (tx.merchant ?? "").toLowerCase();
    const category = (tx.category ?? "").toLowerCase();
    const raw = (tx.rawDescription ?? "").toLowerCase();
    const dateStr = (tx.dateStr ?? "").toLowerCase();
    const amountStr = `${Math.abs(tx.amount)}`.toLowerCase();
    return (
      merchant.includes(q) ||
      category.includes(q) ||
      raw.includes(q) ||
      dateStr.includes(q) ||
      amountStr.includes(q)
    );
  });
}

type SearchMode = "filter" | "ask";

function TransactionsPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { transactions, linked, loading, syncAndRefetch } = useTransactions();
  const { usAccounts, cadAccounts, otherAccounts } = useAccounts(linked);
  const { currencyCode, format: fc, symbol: currSymbol } = useCurrency();
  const { compact: compactView } = useCompactView();
  const { isHidden, hidden: hiddenIds } = useHiddenAccounts();
  const [accountFilter, setAccountFilter] = useState<"spending" | "all">("spending");
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  const visibleUsAccounts = usAccounts.filter((a) => a.id && !isHidden(a.id));
  const visibleCadAccounts = cadAccounts.filter((a) => a.id && !isHidden(a.id));
  const visibleOtherAccounts = otherAccounts.filter((a) => a.id && !isHidden(a.id));

  const spendingUs = visibleUsAccounts.filter((a) => !isInvestmentAccount(a));
  const spendingCad = visibleCadAccounts.filter((a) => !isInvestmentAccount(a));
  const spendingOther = visibleOtherAccounts.filter((a) => !isInvestmentAccount(a));
  const investmentUs = visibleUsAccounts.filter((a) => isInvestmentAccount(a));
  const investmentCad = visibleCadAccounts.filter((a) => isInvestmentAccount(a));
  const investmentOther = visibleOtherAccounts.filter((a) => isInvestmentAccount(a));

  const investmentAccountIds = new Set(
    [...investmentUs, ...investmentCad, ...investmentOther].map((a) => a.id!).filter(Boolean)
  );
  const hasInvestmentAccounts = investmentAccountIds.size > 0;

  // Unified search: one input, toggle between Filter (instant) and Ask (semantic/LLM)
  const semanticQuery = searchParams.get("q") ? decodeURIComponent(searchParams.get("q")!) : "";
  const [searchMode, setSearchMode] = useState<SearchMode>(semanticQuery ? "ask" : "filter");
  const [searchInput, setSearchInput] = useState(semanticQuery || "");
  const filterQuery = searchMode === "filter" ? searchInput : "";
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [dateFilter, setDateFilter] = useState("Last 3 months");
  const [typeFilter, setTypeFilter] = useState("All");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedTx, setSelectedTx] = useState<UITransaction | null>(null);
  const { results: nlFiltered, answer: nlAnswer, loading: nlLoading } = useNLSearch(semanticQuery, transactions);

  // Sync URL ?q= with search state when landing or external nav
  useEffect(() => {
    if (semanticQuery) {
      setSearchMode("ask");
      setSearchInput(semanticQuery);
    } else if (searchMode === "ask" && !searchInput) {
      setSearchMode("filter");
    }
  }, [semanticQuery]);

  useEffect(() => {
    if (filterQuery.trim()) setSelectedCategory("All");
  }, [filterQuery]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchInput.trim();
    if (searchMode === "ask") {
      if (q) router.push(`/app/transactions?q=${encodeURIComponent(q)}`);
      else router.push("/app/transactions");
    }
  };

  const clearSearch = () => {
    setSearchInput("");
    if (searchMode === "ask") router.push("/app/transactions");
  };

  // When a semantic search is active, switch date filter to "All time"
  // so the client-side filter doesn't hide results the backend returned
  useEffect(() => {
    if (semanticQuery.trim()) {
      setDateFilter("All time");
    }
  }, [semanticQuery]);

  useEffect(() => {
    if (selectedAccountId && isHidden(selectedAccountId)) {
      setSelectedAccountId(null);
    }
  }, [selectedAccountId, isHidden]);

  // When no investment accounts, default to "all"
  useEffect(() => {
    if (!hasInvestmentAccounts && accountFilter === "spending") {
      setAccountFilter("all");
    }
  }, [hasInvestmentAccounts, accountFilter]);

  usePullToRefresh(syncAndRefetch, !!linked);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-8 py-8">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-[#3D8E62]/30 border-t-[#3D8E62] rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Fetching your transactions...</p>
        </div>
      </div>
    );
  }

  // Base list: semantic result when top-bar query is set, otherwise all transactions
  const baseList = semanticQuery.trim() ? nlFiltered : transactions;
  // Real-time filter (page search bar): client-side, no LLM
  const filteredBySearch = filterTransactionsByQuery(baseList, filterQuery);
  // Sort: pending first (no filter, just auto-sort)
  const sortedByPending = [...filteredBySearch].sort(
    (a, b) => (a.isPending ? 0 : 1) - (b.isPending ? 0 : 1)
  );
  const hiddenSet = new Set(hiddenIds);
  // Account filter: specific account > all. Investment accounts always excluded on transactions page.
  const afterAccount = (() => {
    const excludeHidden = sortedByPending.filter((tx) => !tx.accountId || !hiddenSet.has(tx.accountId));
    const excludeInvestment = excludeHidden.filter((tx) => !tx.accountId || !investmentAccountIds.has(tx.accountId));
    if (selectedAccountId) {
      return excludeInvestment.filter((tx) => tx.accountId === selectedAccountId);
    }
    return excludeInvestment;
  })();
  const hasUnlinkedTx = selectedAccountId && sortedByPending.some((tx) => !tx.accountId);
  // Category filter
  const afterCategory = selectedCategory === "All"
    ? afterAccount
    : afterAccount.filter((tx) => tx.category === selectedCategory);
  const parseLocalDate = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  // Date filter
  const afterDate = (() => {
    if (dateFilter === "All time") return afterCategory;
    const now = new Date();
    let cutoff: Date;
    switch (dateFilter) {
      case "Last month": {
        cutoff = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
        return afterCategory.filter((tx) => {
          const d = parseLocalDate(tx.date);
          return d >= cutoff && d <= endOfLastMonth;
        });
      }
      case "Last 3 months":
        cutoff = new Date(now.getFullYear(), now.getMonth() - 3, 1);
        return afterCategory.filter((tx) => parseLocalDate(tx.date) >= cutoff);
      case "This year":
        cutoff = new Date(now.getFullYear(), 0, 1);
        return afterCategory.filter((tx) => new Date(tx.date) >= cutoff);
      default: // "This month"
        cutoff = new Date(now.getFullYear(), now.getMonth(), 1);
        return afterCategory.filter((tx) => new Date(tx.date) >= cutoff);
    }
  })();
  // Type filter
  const filtered = (() => {
    switch (typeFilter) {
      case "Recurring":
        return afterDate.filter((tx) => tx.isRecurring);
      case "Split":
        return afterDate.filter((tx) => tx.hasSplitSuggestion);
      case "One-time":
        return afterDate.filter((tx) => !tx.isRecurring);
      default:
        return afterDate;
    }
  })();

  // Split into Pending / Posted sections (bank statement style)
  const pendingTx = filtered.filter((tx) => tx.isPending);
  const postedTx = filtered.filter((tx) => !tx.isPending);

  // Build unique category tabs from actual transaction data (use baseList so categories reflect current view)
  const categoryTabs = ["All", ...Array.from(
    new Set(baseList.map((tx) => tx.category))
  ).sort()];

  // Stats for header: this month spending from filtered, pending count
  const thisMonthSpend = filtered
    .filter((tx) => !tx.isPending && tx.amount < 0)
    .reduce((s, tx) => s + Math.abs(tx.amount), 0);
  const now = new Date();
  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const thisMonthCount = filtered.filter((tx) => tx.date.startsWith(thisMonthKey)).length;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#F7FAF8] to-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-8 py-6 sm:py-8">
        {/* Header */}
        <div className="mb-6">
          {linked && (
            <div className="mb-4 flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EEF7F2] border border-[#D1EAE0] text-[#2D7A52] text-xs font-medium px-2.5 py-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#3D8E62] animate-pulse" />
                Live from linked account
              </span>
              <Link
                href="/app/settings"
                className="text-xs text-[#3D8E62] hover:underline"
              >
                Seeing old or duplicate transactions? Disconnect & reconnect in Settings.
              </Link>
            </div>
          )}
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">Transactions</h1>
              <p className="text-sm text-gray-500 mt-1">{transactions.length} transactions loaded</p>
            </div>
            <div className="flex gap-3 flex-wrap">
              <div className="rounded-xl bg-white border border-gray-100 px-4 py-3 shadow-sm min-w-[120px]">
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">This month</div>
                <div className="text-lg font-bold text-gray-900 mt-0.5">{formatCurrencyAbs(thisMonthSpend, currencyCode)}</div>
                <div className="text-xs text-gray-500 mt-0.5">{thisMonthCount} transactions</div>
              </div>
              <div className="rounded-xl bg-white border border-gray-100 px-4 py-3 shadow-sm min-w-[100px]">
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Pending</div>
                <div className="text-lg font-bold text-amber-600 mt-0.5">{pendingTx.length}</div>
              </div>
              <div className="rounded-xl bg-white border border-gray-100 px-4 py-3 shadow-sm min-w-[100px]">
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Showing</div>
                <div className="text-lg font-bold text-[#3D8E62] mt-0.5">{filtered.length}</div>
              </div>
            </div>
          </div>
        </div>

      {/* Accounts overview — compact cards */}
      {linked && (visibleUsAccounts.length > 0 || visibleCadAccounts.length > 0 || visibleOtherAccounts.length > 0) && (
        <div className="mb-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Your accounts</h2>
          <div className="space-y-4">
            {(spendingUs.length > 0 || spendingCad.length > 0 || spendingOther.length > 0) && (
              <div>
                <div className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">Spending</div>
                <div className="flex flex-wrap gap-3">
                  {spendingUs.map((acc) => {
                    const bal = acc.balance_current ?? acc.balance_available ?? 0;
                    const isSelected = selectedAccountId === acc.id;
                    return (
                      <button
                        key={acc.account_id}
                        onClick={() => { setSelectedAccountId(isSelected ? null : acc.id); setAccountFilter("all"); }}
                        className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                          isSelected
                            ? "border-[#3D8E62] bg-[#EEF7F2] ring-1 ring-[#3D8E62]"
                            : "border-gray-100 hover:border-gray-200 hover:bg-gray-50"
                        }`}
                      >
                        <div className="w-9 h-9 rounded-lg bg-[#3D8E62]/10 flex items-center justify-center text-[#3D8E62] font-semibold text-sm">
                          {(acc.name?.[0] ?? "?").toUpperCase()}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-gray-900 truncate max-w-[140px]">{acc.name}</div>
                          <div className="text-xs text-gray-500">••••{acc.mask ?? "****"}</div>
                          <div className="text-sm font-semibold text-gray-900 mt-0.5">
                            ${typeof bal === "number" ? bal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  {spendingCad.map((acc) => {
                    const bal = acc.balance_current ?? acc.balance_available ?? 0;
                    const isSelected = selectedAccountId === acc.id;
                    return (
                      <button
                        key={acc.account_id}
                        onClick={() => { setSelectedAccountId(isSelected ? null : acc.id); setAccountFilter("all"); }}
                        className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                          isSelected
                            ? "border-[#3D8E62] bg-[#EEF7F2] ring-1 ring-[#3D8E62]"
                            : "border-gray-100 hover:border-gray-200 hover:bg-gray-50"
                        }`}
                      >
                        <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600 font-semibold text-sm">
                          {(acc.name?.[0] ?? "?").toUpperCase()}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-gray-900 truncate max-w-[140px]">{acc.name}</div>
                          <div className="text-xs text-gray-500">••••{acc.mask ?? "****"}</div>
                          <div className="text-sm font-semibold text-gray-900 mt-0.5">
                            C${typeof bal === "number" ? bal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  {spendingOther.map((acc) => {
                    const bal = acc.balance_current ?? acc.balance_available ?? 0;
                    const isSelected = selectedAccountId === acc.id;
                    return (
                      <button
                        key={acc.account_id}
                        onClick={() => { setSelectedAccountId(isSelected ? null : acc.id); setAccountFilter("all"); }}
                        className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                          isSelected ? "border-[#3D8E62] bg-[#EEF7F2]" : "border-gray-100 hover:border-gray-200"
                        }`}
                      >
                        <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center text-gray-600 font-semibold text-sm">
                          {(acc.name?.[0] ?? "?").toUpperCase()}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-gray-900 truncate max-w-[140px]">{acc.name}</div>
                          <div className="text-xs text-gray-500">••••{acc.mask ?? "****"} {acc.iso_currency_code}</div>
                          <div className="text-sm font-semibold text-gray-900 mt-0.5">
                            ${typeof bal === "number" ? bal.toLocaleString("en-US", { minimumFractionDigits: 2 }) : "—"}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {/* Investment accounts hidden on transactions page — shown on home for balance overview */}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {(spendingUs.length > 0 || spendingCad.length > 0 || spendingOther.length > 0) && (
              <button
                onClick={() => { setSelectedAccountId(null); setAccountFilter("all"); }}
                className={`text-xs px-3 py-1.5 rounded-full font-medium ${
                  !selectedAccountId ? "bg-[#3D8E62] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                All
              </button>
            )}
            {[...spendingUs, ...spendingCad, ...spendingOther].filter((a) => a.id).map((acc) => {
              const isSelected = selectedAccountId === acc.id;
              return (
                <button
                  key={acc.account_id}
                  onClick={() => { setSelectedAccountId(isSelected ? null : acc.id); setAccountFilter("all"); }}
                  className={`text-xs px-3 py-1.5 rounded-full font-medium ${
                    isSelected ? "bg-[#3D8E62] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {acc.name?.slice(0, 12)}{acc.name && acc.name.length > 12 ? "…" : ""} ••••{acc.mask ?? "****"}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Unified search: Filter (instant) or Ask (semantic) */}
      <div className="mb-5">
        <div className="flex gap-2 mb-3">
          <button
            type="button"
            onClick={() => { setSearchMode("filter"); if (searchMode === "ask") setSearchInput(""); router.push("/app/transactions"); }}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
              searchMode === "filter" ? "bg-[#3D8E62] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            Filter
          </button>
          <button
            type="button"
            onClick={() => setSearchMode("ask")}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
              searchMode === "ask" ? "bg-[#3D8E62] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            Ask
          </button>
        </div>
        <form onSubmit={handleSearchSubmit} className="relative">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#3D8E62]" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={searchMode === "filter" ? "Filter by name, category, amount..." : "Ask in plain English. e.g. how much on Uber last month"}
            aria-label={searchMode === "filter" ? "Filter transactions" : "Search transactions"}
            className="w-full pl-11 pr-10 py-3 text-sm bg-white border border-gray-200 rounded-xl shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/20 focus:border-[#3D8E62] transition-all"
          />
          {(searchInput || semanticQuery) && (
            <button
              type="button"
              onClick={clearSearch}
              aria-label="Clear"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X size={15} />
            </button>
          )}
        </form>
        {searchMode === "ask" && semanticQuery && (nlLoading || nlAnswer) && (
          <p className="mt-2 text-sm text-[#2D5A44]">{nlLoading ? "Searching..." : nlAnswer}</p>
        )}
      </div>

      <div className="flex gap-6">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1">
            {categoryTabs.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`shrink-0 text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
                  selectedCategory === cat
                    ? "bg-[#3D8E62] text-white"
                    : "bg-white border border-gray-200 text-gray-600 hover:border-gray-300"
                }`}
              >
                {cat === "All" ? "All" : (CATEGORY_LABEL[cat] ?? cat)}
              </button>
            ))}
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            {semanticQuery && nlLoading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <div className="w-7 h-7 border-2 border-[#3D8E62]/30 border-t-[#3D8E62] rounded-full animate-spin" />
                <p className="text-sm text-gray-400">Searching your transactions...</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">
                {nlAnswer || (selectedAccountId ? "No transactions for this account" : "No transactions found")}
                <div className="mt-2 text-xs text-gray-500 space-y-1">
                  {selectedAccountId ? (
                    <>
                      <p>
                        This account has no transactions. You have <strong>{transactions.filter((t) => !t.accountId || !hiddenSet.has(t.accountId)).length} total</strong> —{" "}
                        <button onClick={() => setSelectedAccountId(null)} className="text-[#3D8E62] font-semibold underline">View all transactions</button>
                      </p>
                      <p className="text-gray-400 mt-1">Investment accounts (TFSA, brokerage) often have few day-to-day transactions.</p>
                      {hasUnlinkedTx && (
                        <p className="text-amber-600/90 mt-1">Some older transactions aren&apos;t linked to accounts.</p>
                      )}
                    </>
                  ) : (
                    <>
                      <p>Try a different filter or <button onClick={clearSearch} className="text-[#3D8E62] underline">clear the search</button>.</p>
                      <p>Or change the date to <button onClick={() => setDateFilter("Last 3 months")} className="text-[#3D8E62] font-medium underline">Last 3 months</button> or <button onClick={() => setDateFilter("All time")} className="text-[#3D8E62] font-medium underline">All time</button>.</p>
                      {semanticQuery && <p><button onClick={clearSearch} className="text-[#3D8E62] underline">Clear search</button></p>}
                    </>
                  )}
                </div>
              </div>
            ) : (
              <>
                {pendingTx.length > 0 && (
                  <div className="border-b border-gray-100">
                    <div className={`bg-amber-50 border-b border-amber-100 text-xs font-semibold text-amber-800 ${compactView ? "px-4 py-1.5" : "px-5 py-2.5"}`}>
                      Pending
                    </div>
                    {pendingTx.map((tx, i) => (
                      <TxRow
                        key={tx.id}
                        tx={tx}
                        index={i}
                        expandedId={expandedId}
                        setExpandedId={setExpandedId}
                        onSelect={() => setSelectedTx(tx)}
                        currencyCode={currencyCode}
                        compactView={compactView}
                      />
                    ))}
                  </div>
                )}
                {postedTx.length > 0 && (
                  <div>
                    <div className={`bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-600 ${compactView ? "px-4 py-1.5" : "px-5 py-2.5"}`}>
                      Posted
                    </div>
                    {postedTx.map((tx, i) => (
                      <TxRow
                        key={tx.id}
                        tx={tx}
                        index={i + pendingTx.length}
                        expandedId={expandedId}
                        setExpandedId={setExpandedId}
                        onSelect={() => setSelectedTx(tx)}
                        currencyCode={currencyCode}
                        compactView={compactView}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        <div className="hidden sm:block w-48 shrink-0">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sticky top-4">
            <div className="flex items-center gap-2 mb-4">
              <Filter size={13} className="text-gray-500" />
              <span className="text-xs font-semibold text-gray-700">Filters</span>
            </div>
            <div className="space-y-4">
              <div>
                <div className="text-xs font-medium text-gray-500 mb-2">Date</div>
                <select
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#3D8E62]"
                >
                  <option>Last 3 months</option>
                  <option>This month</option>
                  <option>Last month</option>
                  <option>This year</option>
                  <option>All time</option>
                </select>
              </div>
              <div>
                <div className="text-xs font-medium text-gray-500 mb-2">Category</div>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#3D8E62]"
                >
                  {categoryTabs.map((c) => (
                    <option key={c} value={c}>{c === "All" ? "All" : (CATEGORY_LABEL[c] ?? c)}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="text-xs font-medium text-gray-500 mb-2">Amount range</div>
                <div className="space-y-2">
                  <input
                    type="number"
                    placeholder="Min $"
                    aria-label="Minimum amount"
                    className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#3D8E62]"
                  />
                  <input
                    type="number"
                    placeholder="Max $"
                    aria-label="Maximum amount"
                    className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#3D8E62]"
                  />
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-gray-500 mb-2">Type</div>
                <div className="space-y-1.5">
                  {["All", "Recurring", "Split", "One-time"].map((type) => (
                    <label key={type} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="type"
                        checked={typeFilter === type}
                        onChange={() => setTypeFilter(type)}
                        className="accent-[#3D8E62]"
                      />
                      <span className="text-xs text-gray-600">{type}</span>
                    </label>
                  ))}
                </div>
              </div>
              <button
                onClick={() => {
                  setSelectedCategory("All");
                  setDateFilter("This month");
                  setTypeFilter("All");
                  setSearchInput("");
                }}
                className="w-full text-xs text-gray-500 hover:text-gray-700 py-1 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Clear all
              </button>
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {selectedTx && (
          <TransactionDrawer tx={selectedTx} onClose={() => setSelectedTx(null)} currencyCode={currencyCode} />
        )}
      </AnimatePresence>
      </div>
    </div>
  );
}

export default function TransactionsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#3D8E62]/30 border-t-[#3D8E62] rounded-full animate-spin" />
      </div>
    }>
      <TransactionsPageContent />
    </Suspense>
  );
}

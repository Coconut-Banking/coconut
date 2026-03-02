"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import {
  Search,
  Filter,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Users,
  X,
  MapPin,
  Tag,
  StickyNote,
  Share2,
  Zap,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useTransactions } from "@/hooks/useTransactions";
import { useDemoMode } from "@/components/AppGate";
import { useNLSearch } from "@/hooks/useNLSearch";
import type { Transaction } from "@/lib/mockData";

// Display labels for known Plaid primary categories
const CATEGORY_LABEL: Record<string, string> = {
  "FOOD AND DRINK": "Food & Drink",
  "GROCERIES": "Groceries",
  "ENTERTAINMENT": "Entertainment",
  "TRANSPORTATION": "Transport",
  "TRAVEL": "Travel",
  "SHOPPING": "Shopping",
  "GENERAL MERCHANDISE": "Shopping",
  "GENERAL SERVICES": "Services",
  "PERSONAL CARE": "Personal Care",
  "HEALTHCARE": "Health",
  "RENT AND UTILITIES": "Utilities",
  "HOME IMPROVEMENT": "Home",
  "LOAN PAYMENTS": "Loans",
  "INCOME": "Income",
  "TRANSFER IN": "Transfer In",
  "TRANSFER OUT": "Transfer Out",
  "OTHER": "Other",
};

function MerchantAvatar({ name, color }: { name: string; color: string }) {
  return (
    <div
      className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-bold shrink-0"
      style={{ backgroundColor: color }}
    >
      {name[0]}
    </div>
  );
}

type SplitMode = "person" | "group";

function TransactionDrawer({ tx, onClose }: { tx: Transaction; onClose: () => void }) {
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

  const loadPeopleAndGroups = async () => {
    const res = await fetch("/api/groups/people");
    if (res.ok) {
      const data = await res.json();
      setPeople(data.people ?? []);
      setGroups(data.groups ?? []);
    }
  };

  const loadGroupMembers = async (groupId: string) => {
    setMembers([]);
    const res = await fetch(`/api/groups/${groupId}`);
    if (res.ok) {
      const data = await res.json();
      setMembers(data.members ?? []);
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
      setNewPersonName("");
      await loadPeopleAndGroups();
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
    const sharePerPerson = Math.floor((totalAmount / members.length) * 100) / 100;
    const remainder = Math.round((totalAmount - sharePerPerson * members.length) * 100) / 100;
    const shares = members.map((m, i) => ({
      memberId: m.id,
      amount: i === 0 ? sharePerPerson + remainder : sharePerPerson,
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
        className="fixed right-0 top-0 bottom-0 w-96 bg-white border-l border-gray-200 z-50 flex flex-col shadow-xl"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">Transaction details</h3>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
          >
            <X size={15} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-6 border-b border-gray-100">
            <div className="flex items-start gap-4">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-xl font-bold shrink-0"
                style={{ backgroundColor: tx.merchantColor }}
              >
                {tx.merchant[0]}
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-bold text-gray-900">{tx.merchant}</h2>
                <div className="text-2xl font-bold text-gray-900 mt-1">${Math.abs(tx.amount).toFixed(2)}</div>
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
                <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-[#C3E0D3] bg-[#EEF7F2] hover:bg-[#E0F2EA] text-[#2D7A52] transition-colors text-left">
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
              <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-100 hover:bg-gray-50 text-gray-700 transition-colors text-left">
                <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center shrink-0">
                  <RefreshCw size={15} className="text-gray-500" />
                </div>
                <div>
                  <div className="text-sm font-medium">Mark as subscription</div>
                  <div className="text-xs text-gray-400">Track this as a recurring charge</div>
                </div>
              </button>
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
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/20 focus:border-[#3D8E62]"
                    rows={3}
                  />
                  <button className="mt-1.5 text-xs text-[#3D8E62] font-medium">Save note</button>
                </div>
              )}
              <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-100 hover:bg-gray-50 text-gray-700 transition-colors text-left">
                <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center shrink-0">
                  <Share2 size={15} className="text-gray-500" />
                </div>
                <div>
                  <div className="text-sm font-medium">Tag to shared space</div>
                  <div className="text-xs text-gray-400">Add to Weekend Trip or other spaces</div>
                </div>
              </button>
              <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-100 hover:bg-gray-50 text-gray-700 transition-colors text-left">
                <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center shrink-0">
                  <Tag size={15} className="text-gray-500" />
                </div>
                <div>
                  <div className="text-sm font-medium">Edit category</div>
                  <div className="text-xs text-gray-400">Currently: {tx.category}</div>
                </div>
              </button>
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
                          className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            const gid = await createPersonAndGroup();
                            if (gid) {
                              setSelectedPerson({ groupId: gid, memberId: "", displayName: newPersonName.trim() });
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
                      ${Math.abs(tx.amount).toFixed(2)} ÷ {members.length} = $
                      {(Math.abs(tx.amount) / members.length).toFixed(2)} each
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

const nlExamples = [
  "Find that Uber from last month",
  "Coffee in January",
  "Dinner with Alex",
  "Subscriptions over $10",
];

export default function TransactionsPage() {
  const searchParams = useSearchParams();
  const { transactions, linked, loading } = useTransactions();
  const isDemo = useDemoMode();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [nlHint, setNlHint] = useState(0);
  const { results: nlFiltered, answer: nlAnswer, loading: nlLoading } = useNLSearch(searchQuery, transactions);

  useEffect(() => {
    const q = searchParams.get("q");
    if (q) setSearchQuery(decodeURIComponent(q));
  }, [searchParams]);

  useEffect(() => {
    if (searchQuery.trim()) setSelectedCategory("All");
  }, [searchQuery]);

  if (linked && loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-8 py-8">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-[#3D8E62]/30 border-t-[#3D8E62] rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Loading your data...</p>
        </div>
      </div>
    );
  }

  // Build unique category tabs from actual transaction data
  const categoryTabs = ["All", ...Array.from(
    new Set(transactions.map((tx) => tx.category))
  ).sort()];

  const filtered = selectedCategory === "All"
    ? nlFiltered
    : nlFiltered.filter((tx) => tx.category === selectedCategory);

  return (
    <div className="max-w-4xl mx-auto px-8 py-8">
      {(linked || isDemo) && (
        <div className="mb-4 flex items-center gap-2">
          {linked ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EEF7F2] border border-[#D1EAE0] text-[#2D7A52] text-xs font-medium px-2.5 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#3D8E62] animate-pulse" />
              Live from linked account
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-100 text-amber-700 text-xs font-medium px-2.5 py-1">
              Demo mode
            </span>
          )}
        </div>
      )}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Transactions</h1>
        <p className="text-sm text-gray-500 mt-1">{transactions.length} transactions loaded</p>
      </div>

      {searchQuery && (nlLoading || nlAnswer) && (
        <div className="mb-5 rounded-2xl bg-[#EEF7F2] border border-[#D1EAE0] px-5 py-4">
          {nlLoading ? (
            <p className="text-sm text-[#2D5A44]/60">Searching...</p>
          ) : (
            <p className="text-sm text-[#2D5A44] leading-relaxed">{nlAnswer}</p>
          )}
        </div>
      )}

      <div className="relative mb-5">
        <div className="absolute left-4 top-1/2 -translate-y-1/2">
          {nlLoading ? (
            <div className="w-4 h-4 border-2 border-[#3D8E62]/30 border-t-[#3D8E62] rounded-full animate-spin" />
          ) : (
            <Search size={16} className="text-[#3D8E62]" />
          )}
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={nlExamples[nlHint % nlExamples.length]}
          onFocus={() => setNlHint((n) => n + 1)}
          className="w-full pl-11 pr-4 py-3 text-sm bg-white border border-gray-200 rounded-xl shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/20 focus:border-[#3D8E62] transition-all"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X size={15} />
          </button>
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
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            {filtered.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">No transactions found</div>
            ) : (
              filtered.map((tx, i) => (
                <div key={tx.id}>
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.03 }}
                    className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors cursor-pointer border-b border-gray-50 last:border-b-0"
                    onClick={() => setSelectedTx(tx)}
                  >
                    <MerchantAvatar name={tx.merchant} color={tx.merchantColor} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-medium text-gray-900">{tx.merchant}</span>
                        {tx.isRecurring && <RefreshCw size={11} className="text-gray-300" />}
                        {tx.hasSplitSuggestion && (
                          <div className="flex items-center gap-1 bg-[#EEF7F2] text-[#3D8E62] text-xs px-2 py-0.5 rounded-full">
                            <Users size={9} />
                            <span>Split</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${tx.categoryColor}`}>{tx.category}</span>
                        <span className="text-xs text-gray-400">{tx.dateStr}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-semibold text-gray-900">${Math.abs(tx.amount).toFixed(2)}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedId(expandedId === tx.id ? null : tx.id);
                        }}
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
                            <div className="text-xs text-gray-400 mb-0.5">Recurring</div>
                            <div className="text-xs text-gray-600">
                              {tx.isRecurring ? "Monthly subscription" : "One-time charge"}
                            </div>
                          </div>
                          {tx.hasSplitSuggestion && (
                            <div>
                              <div className="text-xs text-gray-400 mb-0.5">Split suggestion</div>
                              <div className="text-xs text-[#3D8E62] font-medium">
                                Split with {tx.splitWith} — ${(Math.abs(tx.amount) / 2).toFixed(2)} each
                              </div>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="w-48 shrink-0">
          <div className="bg-white rounded-2xl border border-gray-100 p-4 sticky top-4">
            <div className="flex items-center gap-2 mb-4">
              <Filter size={13} className="text-gray-500" />
              <span className="text-xs font-semibold text-gray-700">Filters</span>
            </div>
            <div className="space-y-4">
              <div>
                <div className="text-xs font-medium text-gray-500 mb-2">Date</div>
                <select className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#3D8E62]">
                  <option>This month</option>
                  <option>Last month</option>
                  <option>Last 3 months</option>
                  <option>This year</option>
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
                    className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#3D8E62]"
                  />
                  <input
                    type="number"
                    placeholder="Max $"
                    className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#3D8E62]"
                  />
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-gray-500 mb-2">Type</div>
                <div className="space-y-1.5">
                  {["All", "Recurring", "Split", "One-time"].map((type) => (
                    <label key={type} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="type" defaultChecked={type === "All"} className="accent-[#3D8E62]" />
                      <span className="text-xs text-gray-600">{type}</span>
                    </label>
                  ))}
                </div>
              </div>
              <button
                onClick={() => {
                  setSelectedCategory("All");
                  setSearchQuery("");
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
          <TransactionDrawer tx={selectedTx} onClose={() => setSelectedTx(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

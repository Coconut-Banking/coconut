"use client";

import { Users, CheckCircle2, ArrowRight, Plus, DollarSign } from "lucide-react";
import { motion } from "motion/react";
import { sharedTransactions } from "@/lib/mockData";
import { useState } from "react";
import { useTransactions } from "@/hooks/useTransactions";
import { useDemoMode } from "@/components/AppGate";

const members = [
  { name: "You", initials: "JD", color: "#3D8E62" },
  { name: "Alex", initials: "AL", color: "#4A6CF7" },
  { name: "Sam", initials: "SM", color: "#E8507A" },
  { name: "Jordan", initials: "JO", color: "#F59E0B" },
];

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

const spaces = [
  { id: "weekend-trip", name: "Weekend Trip", emoji: "🏔️", date: "Feb 14–22" },
  { id: "apt", name: "Apartment", emoji: "🏠", date: "Ongoing" },
];

export default function SharedSpacePage() {
  const [activeSpace, setActiveSpace] = useState("weekend-trip");
  const [settled, setSettled] = useState(false);
  const { linked } = useTransactions();
  const isDemo = useDemoMode();

  if (linked && !isDemo) {
    return (
      <div className="max-w-3xl mx-auto px-8 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Shared Expenses</h1>
          <p className="text-sm text-gray-500 mt-1">Split and settle with friends — coming soon.</p>
        </div>
        <div className="bg-gray-50 border border-gray-100 rounded-2xl p-12 text-center">
          <Users size={32} className="text-gray-300 mx-auto mb-4" />
          <p className="text-sm text-gray-500">No shared spaces yet. Tag transactions to split with friends when this feature launches.</p>
        </div>
      </div>
    );
  }

  const totalSpend = sharedTransactions.reduce((a, t) => a + Math.abs(t.amount), 0);
  const yourShare = sharedTransactions.reduce((a, t) => a + t.yourShare, 0);

  const owedToYou = members
    .filter((m) => m.name !== "You")
    .map((m) => ({
      ...m,
      amount: m.name === "Alex" ? 86.0 : m.name === "Sam" ? -53.33 : 20.0,
    }));

  return (
    <div className="max-w-3xl mx-auto px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Shared Expenses</h1>
        <p className="text-sm text-gray-500 mt-1">Split and settle with friends and roommates.</p>
      </div>

      <div className="flex items-center gap-3 mb-6">
        {spaces.map((space) => (
          <button
            key={space.id}
            onClick={() => setActiveSpace(space.id)}
            className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all ${
              activeSpace === space.id
                ? "bg-[#3D8E62] text-white border-[#3D8E62]"
                : "bg-white border-gray-200 text-gray-700 hover:border-gray-300"
            }`}
          >
            <span>{space.emoji}</span>
            <span>{space.name}</span>
            <span className={`text-xs ${activeSpace === space.id ? "text-white/70" : "text-gray-400"}`}>
              {space.date}
            </span>
          </button>
        ))}
        <button className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-dashed border-gray-200 text-sm text-gray-400 hover:border-gray-300 hover:text-gray-600 transition-colors">
          <Plus size={14} />
          New space
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-4">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl">🏔️</span>
              <h2 className="text-lg font-bold text-gray-900">Weekend Trip</h2>
            </div>
            <p className="text-sm text-gray-500">Feb 14–22, 2026 · 4 people</p>
          </div>
          <div className="flex items-center gap-2">
            <Users size={14} className="text-gray-400" />
            <div className="flex -space-x-2">
              {members.map((m) => (
                <div
                  key={m.name}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold border-2 border-white"
                  style={{ backgroundColor: m.color }}
                  title={m.name}
                >
                  {m.initials}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 pt-4 border-t border-gray-100">
          <div>
            <div className="text-xs text-gray-400 mb-0.5">Total spent</div>
            <div className="text-lg font-bold text-gray-900">${totalSpend.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400 mb-0.5">Your share</div>
            <div className="text-lg font-bold text-gray-900">${yourShare.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400 mb-0.5">You&apos;re owed</div>
            <div className="text-lg font-bold text-[#3D8E62]">$86.00</div>
          </div>
        </div>
      </div>

      <div className="bg-[#F0F9F4] border border-[#C3E0D3] rounded-2xl p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <DollarSign size={16} className="text-[#3D8E62]" />
            <span className="text-sm font-semibold text-gray-900">Settlement summary</span>
          </div>
          {!settled && (
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => setSettled(true)}
              className="flex items-center gap-2 bg-[#3D8E62] hover:bg-[#2D7A52] text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            >
              Settle up
              <ArrowRight size={13} />
            </motion.button>
          )}
          {settled && (
            <div className="flex items-center gap-1.5 text-[#3D8E62] text-sm font-medium">
              <CheckCircle2 size={15} />
              Settled!
            </div>
          )}
        </div>
        <div className="space-y-2.5">
          {owedToYou.map((m) => (
            <div key={m.name} className="flex items-center gap-3">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0"
                style={{ backgroundColor: m.color }}
              >
                {m.initials}
              </div>
              <div className="flex-1 text-sm text-gray-700">
                {m.amount > 0 ? (
                  <span>
                    <strong>{m.name}</strong> owes you <strong className="text-[#3D8E62]">${m.amount.toFixed(2)}</strong>
                  </span>
                ) : (
                  <span>
                    You owe <strong>{m.name}</strong> <strong className="text-red-500">${Math.abs(m.amount).toFixed(2)}</strong>
                  </span>
                )}
              </div>
              {!settled && (
                <button className="text-xs text-[#3D8E62] font-medium hover:underline shrink-0">
                  {m.amount > 0 ? "Remind" : "Pay"}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Transactions</div>
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {sharedTransactions.map((tx, i) => (
          <motion.div
            key={tx.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className="flex items-center gap-4 px-5 py-4 border-b border-gray-50 last:border-b-0 hover:bg-gray-50 transition-colors"
          >
            <MerchantAvatar name={tx.merchant} color={tx.merchantColor} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-sm font-medium text-gray-900">{tx.merchant}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${tx.categoryColor}`}>{tx.category}</span>
              </div>
              <div className="text-xs text-gray-400">
                {tx.paidBy === "You" ? (
                  <span>
                    Paid by <strong className="text-gray-600">you</strong> · split with {tx.splitWith.join(", ")}
                  </span>
                ) : (
                  <span>
                    Paid by <strong className="text-gray-600">{tx.paidBy}</strong> · split with {tx.splitWith.join(", ")}
                  </span>
                )}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm font-semibold text-gray-900">${Math.abs(tx.amount).toFixed(2)}</div>
              <div className="text-xs text-gray-400">Your share: ${tx.yourShare.toFixed(2)}</div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

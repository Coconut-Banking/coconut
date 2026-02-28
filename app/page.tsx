"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Shield, RefreshCw, Users, Sparkles, Lock, Star, ChevronRight, Check } from "lucide-react";
import { motion } from "motion/react";
import { useState, useEffect } from "react";
import { setDemoMode } from "@/components/AppGate";

const searchExamples = [
  "Find that Uber from last month",
  "Dinner with Alex in January",
  "Subscriptions over $20",
  "How much did I spend on coffee?",
  "All Whole Foods receipts this year",
  "Flights I need to split with Sam",
];

function TypewriterSearch() {
  const [idx, setIdx] = useState(0);
  const [displayed, setDisplayed] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const target = searchExamples[idx];
    let timeout: ReturnType<typeof setTimeout>;

    if (!isDeleting && displayed.length < target.length) {
      timeout = setTimeout(() => setDisplayed(target.slice(0, displayed.length + 1)), 52);
    } else if (!isDeleting && displayed.length === target.length) {
      timeout = setTimeout(() => setIsDeleting(true), 1800);
    } else if (isDeleting && displayed.length > 0) {
      timeout = setTimeout(() => setDisplayed(displayed.slice(0, -1)), 28);
    } else if (isDeleting && displayed.length === 0) {
      setIsDeleting(false);
      setIdx((i) => (i + 1) % searchExamples.length);
    }

    return () => clearTimeout(timeout);
  }, [displayed, isDeleting, idx]);

  return (
    <div
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={`relative flex items-center gap-3 bg-white/10 backdrop-blur-sm border rounded-2xl px-5 py-4 cursor-text transition-all duration-200 ${
        focused ? "border-white/40 bg-white/15" : "border-white/20"
      }`}
    >
      <Sparkles size={18} className="text-[#6DD9A4] shrink-0" />
      <span className="text-white/90 text-base flex-1 min-h-[1.5rem] leading-none flex items-center">
        {displayed}
        <span className="ml-0.5 inline-block w-0.5 h-5 bg-[#6DD9A4] animate-pulse" />
      </span>
      <div className="shrink-0 bg-[#3D8E62] hover:bg-[#2D7A52] text-white text-sm px-4 py-2 rounded-xl font-medium transition-colors cursor-pointer">
        Search
      </div>
    </div>
  );
}

const cleanupExamples = [
  { raw: "AMZN MKTP US*1X4Y7Z9A2", clean: "Amazon", category: "Shopping", color: "#FF9900" },
  { raw: "UBER* TRIP HELP.UBER.COM CA", clean: "Uber", category: "Transport", color: "#000000" },
  { raw: "NETFLIX.COM 866-716-0414 CA", clean: "Netflix", category: "Entertainment", color: "#E50914" },
  { raw: "SQ *SWEETGREEN SAN FRANCISCO", clean: "Sweetgreen", category: "Dining", color: "#006B3F" },
];

function CleanupDemo() {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setRevealed(true), 800);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="space-y-2.5">
      {cleanupExamples.map((ex, i) => (
        <motion.div
          key={ex.raw}
          initial={{ opacity: 0, x: -12 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ delay: i * 0.1 + 0.2, duration: 0.4 }}
          className="flex items-center gap-3 bg-white rounded-xl border border-gray-100 px-4 py-3"
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0"
            style={{ backgroundColor: ex.color }}
          >
            {ex.clean[0]}
          </div>
          <div className="flex-1 min-w-0">
            <motion.div
              key={revealed ? "clean" : "raw"}
              initial={{ opacity: 0, y: revealed ? 4 : -4 }}
              animate={{ opacity: 1, y: 0 }}
              className={revealed ? "text-sm font-semibold text-gray-900" : "text-xs text-gray-400 font-mono truncate"}
            >
              {revealed ? ex.clean : ex.raw}
            </motion.div>
          </div>
          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full shrink-0">{ex.category}</span>
          {revealed && (
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 300 }}>
              <Check size={14} className="text-[#3D8E62] shrink-0" />
            </motion.div>
          )}
        </motion.div>
      ))}
    </div>
  );
}

function SplitDemo() {
  const [settled, setSettled] = useState(false);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">🏔️</span>
          <div>
            <div className="text-sm font-semibold text-gray-900">Weekend Trip</div>
            <div className="text-xs text-gray-400">4 people · $1,087.50</div>
          </div>
        </div>
        <div className="flex -space-x-2">
          {["#3D8E62","#4A6CF7","#E8507A","#F59E0B"].map((c, i) => (
            <div key={i} className="w-7 h-7 rounded-full border-2 border-white flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: c }}>
              {["J","A","S","M"][i]}
            </div>
          ))}
        </div>
      </div>
      <div className="px-5 py-3 space-y-2">
        {[
          { name: "Alex", owes: 86.00, color: "#4A6CF7" },
          { name: "Sam", owes: -53.33, color: "#E8507A" },
          { name: "Maya", owes: 20.00, color: "#F59E0B" },
        ].map((p) => (
          <div key={p.name} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: p.color }}>{p.name[0]}</div>
              <span className="text-gray-700">{p.name}</span>
            </div>
            <span className={p.owes > 0 ? "text-[#3D8E62] font-semibold" : "text-red-500 font-semibold"}>
              {p.owes > 0 ? `owes $${p.owes.toFixed(2)}` : `you owe $${Math.abs(p.owes).toFixed(2)}`}
            </span>
          </div>
        ))}
      </div>
      <div className="px-5 py-4 border-t border-gray-100">
        <button
          onClick={() => setSettled(!settled)}
          className={`w-full py-2.5 rounded-xl text-sm font-medium transition-all ${
            settled
              ? "bg-[#EEF7F2] text-[#3D8E62] flex items-center justify-center gap-2"
              : "bg-[#3D8E62] text-white hover:bg-[#2D7A52]"
          }`}
        >
          {settled ? <><Check size={14} /> All settled!</> : "Settle up →"}
        </button>
      </div>
    </div>
  );
}

const subs = [
  { name: "Netflix", amount: 15.99, prev: 13.32, alert: true, color: "#E50914" },
  { name: "Spotify", amount: 9.99, prev: 9.99, alert: false, color: "#1DB954" },
  { name: "Adobe CC", amount: 54.99, prev: 54.99, alert: true, dup: true, color: "#FF0000" },
  { name: "Apple iCloud", amount: 2.99, prev: 2.99, alert: false, color: "#555" },
];

export default function LandingPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-white">
      <nav className="fixed top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-md border-b border-white/10">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#3D8E62] flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 2C7 2 3 4.5 3 8C3 10.2 4.8 12 7 12C9.2 12 11 10.2 11 8C11 4.5 7 2 7 2Z" fill="white" fillOpacity="0.9"/>
                <path d="M7 5C7 5 5 6.5 5 8.5C5 9.6 5.9 10.5 7 10.5" stroke="white" strokeWidth="0.8" strokeLinecap="round"/>
              </svg>
            </div>
            <span className="text-[15px] font-semibold text-white tracking-tight">Coconut</span>
          </Link>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setDemoMode(true);
                router.push("/app/dashboard");
              }}
              className="text-sm text-white/60 hover:text-white px-4 py-2 rounded-lg transition-colors"
            >
              Demo
            </button>
            <button onClick={() => router.push("/login")} className="text-sm text-white/60 hover:text-white px-4 py-2 rounded-lg transition-colors">
              Sign in
            </button>
            <button
              onClick={() => router.push("/connect")}
              className="text-sm bg-[#3D8E62] hover:bg-[#2D7A52] text-white px-4 py-2 rounded-xl font-medium transition-colors ml-1"
            >
              Get started
            </button>
          </div>
        </div>
      </nav>

      <section className="relative bg-gray-950 pt-14 overflow-hidden">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-[#3D8E62]/15 rounded-full blur-[120px]" />
          <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/8 rounded-full blur-[80px]" />
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-purple-500/8 rounded-full blur-[80px]" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]" />
        </div>

        <div className="relative max-w-3xl mx-auto px-6 pt-24 pb-16 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="inline-flex items-center gap-2 bg-[#3D8E62]/15 border border-[#3D8E62]/30 text-[#6DD9A4] text-xs font-medium px-3.5 py-1.5 rounded-full mb-8">
              <Star size={10} fill="currentColor" />
              Smarter than Copilot. Calmer than Monarch.
            </div>

            <h1 className="text-6xl font-bold text-white leading-[1.1] tracking-tight mb-6">
              Your money,<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#6DD9A4] to-[#3D8E62]">
                cleaned up.
              </span>
            </h1>

            <p className="text-lg text-white/50 leading-relaxed mb-10 max-w-xl mx-auto">
              Search in plain English. Split without spreadsheets. Understand subscriptions before they bleed you dry.
            </p>

            <div className="max-w-xl mx-auto mb-8">
              <TypewriterSearch />
            </div>

            <div className="flex items-center justify-center gap-4">
              <button
                onClick={() => router.push("/connect")}
                className="flex items-center gap-2 bg-[#3D8E62] hover:bg-[#2D7A52] text-white px-6 py-3 rounded-xl text-sm font-medium transition-all duration-200 shadow-lg shadow-[#3D8E62]/25"
              >
                Connect your bank
                <ArrowRight size={15} />
              </button>
              <button
                onClick={() => {
                  setDemoMode(true);
                  router.push("/app/dashboard");
                }}
                className="flex items-center gap-2 text-white/50 hover:text-white/80 text-sm transition-colors"
              >
                See live demo <ChevronRight size={14} />
              </button>
            </div>
          </motion.div>
        </div>

        <div className="relative border-t border-white/5 py-4">
          <div className="max-w-2xl mx-auto flex items-center justify-center gap-8 text-xs text-white/30">
            <div className="flex items-center gap-1.5"><Shield size={11} className="text-[#6DD9A4]" /> 256-bit encryption</div>
            <div className="flex items-center gap-1.5"><Lock size={11} className="text-[#6DD9A4]" /> Read-only access</div>
            <div className="flex items-center gap-1.5"><Check size={11} className="text-[#6DD9A4]" /> SOC 2 compliant</div>
            <div className="flex items-center gap-1.5"><Check size={11} className="text-[#6DD9A4]" /> No credential storage</div>
          </div>
        </div>
      </section>

      <section className="bg-[#F7FAF8] py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 tracking-tight mb-3">
              Three things your bank app can&apos;t do
            </h2>
            <p className="text-gray-500">Coconut does the hard work so you can just understand.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-5">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
              className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm"
            >
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-xl bg-[#EEF7F2] flex items-center justify-center">
                  <Sparkles size={15} className="text-[#3D8E62]" />
                </div>
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Auto Cleanup</span>
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-1">Raw garbage → clean names</h3>
              <p className="text-sm text-gray-400 mb-5">No more AMZN MKTP US*1A2. Coconut normalizes every merchant automatically.</p>
              <CleanupDemo />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="bg-gray-950 rounded-3xl border border-white/10 p-6 shadow-sm"
            >
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-xl bg-[#3D8E62]/20 flex items-center justify-center">
                  <Sparkles size={15} className="text-[#6DD9A4]" />
                </div>
                <span className="text-xs font-semibold text-white/40 uppercase tracking-wider">Natural Language</span>
              </div>
              <h3 className="text-lg font-bold text-white mb-1">Ask anything, get answers</h3>
              <p className="text-sm text-white/40 mb-5">Type how you think. Coconut understands context, not just keywords.</p>
              <div className="space-y-2.5">
                {searchExamples.slice(0, 4).map((q, i) => (
                  <motion.div
                    key={q}
                    initial={{ opacity: 0, x: -8 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.08 + 0.3 }}
                    className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5"
                  >
                    <Sparkles size={12} className="text-[#6DD9A4] shrink-0" />
                    <span className="text-sm text-white/70">{q}</span>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm"
            >
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center">
                  <Users size={15} className="text-blue-600" />
                </div>
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Shared Spaces</span>
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-1">Settle trips, dinners, anything</h3>
              <p className="text-sm text-gray-400 mb-5">Tag transactions to shared spaces. One tap to see who owes what.</p>
              <SplitDemo />
            </motion.div>
          </div>
        </div>
      </section>

      <section className="py-20 px-6">
        <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-100 text-amber-700 text-xs font-medium px-3.5 py-1.5 rounded-full mb-5">
              <RefreshCw size={10} />
              Subscription Intelligence
            </div>
            <h2 className="text-3xl font-bold text-gray-900 tracking-tight mb-4">
              Stop paying for things you forgot about
            </h2>
            <p className="text-gray-500 mb-6 leading-relaxed">
              Coconut detects price increases, duplicate subscriptions, and free trials that silently became paid — before your bank statement does.
            </p>
            <div className="space-y-3">
              {[
                { icon: "↑", text: "Netflix price increased 20% last month", color: "text-red-500", bg: "bg-red-50" },
                { icon: "⚠", text: "Duplicate Adobe subscription detected", color: "text-amber-600", bg: "bg-amber-50" },
                { icon: "✓", text: "Notion dropped 50% — you saved $10", color: "text-[#3D8E62]", bg: "bg-[#EEF7F2]" },
              ].map((item) => (
                <div key={item.text} className={`flex items-center gap-3 ${item.bg} rounded-xl px-4 py-3`}>
                  <span className={`text-sm font-bold ${item.color}`}>{item.icon}</span>
                  <span className="text-sm text-gray-700">{item.text}</span>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-900">Active subscriptions</span>
              <span className="text-sm font-bold text-gray-900">$113.96<span className="text-xs text-gray-400 font-normal">/mo</span></span>
            </div>
            {subs.map((s) => (
              <div key={s.name} className="flex items-center gap-3 px-5 py-3.5 border-b border-gray-50 last:border-b-0">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ backgroundColor: s.color }}>
                  {s.name[0]}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">{s.name}</span>
                    {s.alert && !("dup" in s && s.dup) && (
                      <span className="text-xs bg-red-50 text-red-600 px-1.5 py-0.5 rounded-full">↑ 20%</span>
                    )}
                    {"dup" in s && s.dup && (
                      <span className="text-xs bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded-full">Duplicate?</span>
                    )}
                  </div>
                </div>
                <span className="text-sm font-semibold text-gray-900">${s.amount.toFixed(2)}</span>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      <section className="bg-gray-950 py-20 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-white tracking-tight mb-3">
            Not another dashboard
          </h2>
          <p className="text-white/40 mb-10">Coconut is built around understanding, not data overload.</p>
          <div className="grid grid-cols-3 gap-4">
            {[
              {
                name: "Monarch",
                color: "border-white/10",
                features: ["Net worth tracking", "Budget categories", "Investment sync", "Heavy charts", "Steep learning curve"],
                highlight: false,
              },
              {
                name: "Coconut",
                color: "border-[#3D8E62] bg-[#3D8E62]/5",
                highlight: true,
                features: ["Natural language search", "Auto merchant cleanup", "Shared expense spaces", "Subscription alerts", "One-tap settle up"],
              },
              {
                name: "Copilot",
                color: "border-white/10",
                features: ["iOS-only", "Beautiful design", "AI categorization", "Net worth view", "No web app"],
                highlight: false,
              },
            ].map((app) => (
              <div
                key={app.name}
                className={`rounded-2xl border p-5 text-left ${app.color} ${app.highlight ? "ring-1 ring-[#3D8E62]/30" : ""}`}
              >
                {app.highlight && (
                  <div className="text-xs bg-[#3D8E62] text-white px-2 py-0.5 rounded-full inline-block mb-3 font-medium">You are here</div>
                )}
                <div className={`text-base font-bold mb-4 ${app.highlight ? "text-white" : "text-white/40"}`}>{app.name}</div>
                <ul className="space-y-2.5">
                  {app.features.map((f) => (
                    <li key={f} className={`flex items-start gap-2 text-xs ${app.highlight ? "text-white/70" : "text-white/25"}`}>
                      <Check size={12} className={`mt-0.5 shrink-0 ${app.highlight ? "text-[#6DD9A4]" : "text-white/20"}`} />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <h2 className="text-4xl font-bold text-gray-900 tracking-tight mb-3">
            Ready to clean up?
          </h2>
          <p className="text-gray-500 mb-8 max-w-sm mx-auto">
            Connect your bank in 2 minutes. Read-only. No credentials stored. Cancel anytime.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => router.push("/connect")}
              className="flex items-center gap-2 bg-[#3D8E62] hover:bg-[#2D7A52] text-white px-8 py-3.5 rounded-xl text-sm font-medium transition-all duration-200 shadow-md shadow-[#3D8E62]/20"
            >
              Connect your bank
              <ArrowRight size={15} />
            </button>
            <button
              onClick={() => {
                setDemoMode(true);
                router.push("/app/dashboard");
              }}
              className="flex items-center gap-2 bg-white border border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50 px-6 py-3.5 rounded-xl text-sm font-medium transition-all duration-200"
            >
              See demo
            </button>
          </div>
        </motion.div>
      </section>

      <footer className="border-t border-gray-100 py-8">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-md bg-[#3D8E62] flex items-center justify-center">
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                <path d="M7 2C7 2 3 4.5 3 8C3 10.2 4.8 12 7 12C9.2 12 11 10.2 11 8C11 4.5 7 2 7 2Z" fill="white"/>
              </svg>
            </div>
            <span className="text-sm font-semibold text-gray-700">Coconut</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-gray-400">
            {["Privacy", "Security", "Terms", "Support"].map((link) => (
              <button key={link} className="hover:text-gray-600 transition-colors">{link}</button>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}

"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Shield,
  Lock,
  Check,
  Sparkles,
  Smartphone,
  Nfc,
  Building2,
  Receipt,
  Wallet,
} from "lucide-react";
import { motion } from "motion/react";
import { useState, useEffect } from "react";
import { AppStoreBadge } from "@/components/landing/AppStoreBadge";

const IOS_APP_URL = process.env.NEXT_PUBLIC_IOS_APP_URL ?? "";

const gridStyle = {
  backgroundImage: `linear-gradient(rgba(255,255,255,0.028) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.028) 1px, transparent 1px)`,
  backgroundSize: "64px 64px",
} as const;

const searchExamples = [
  "Find that Uber from last month",
  "Dinner with Alex in January",
  "Subscriptions over $20",
  "How much did I spend on coffee?",
  "All Whole Foods receipts this year",
  "Flights I need to split with Sam",
];

function TypewriterSearchHero() {
  const [idx, setIdx] = useState(0);
  const [displayed, setDisplayed] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const target = searchExamples[idx];
    let timeout: ReturnType<typeof setTimeout>;

    if (!isDeleting && displayed.length < target.length) {
      timeout = setTimeout(() => setDisplayed(target.slice(0, displayed.length + 1)), 48);
    } else if (!isDeleting && displayed.length === target.length) {
      timeout = setTimeout(() => setIsDeleting(true), 1900);
    } else if (isDeleting && displayed.length > 0) {
      timeout = setTimeout(() => setDisplayed(displayed.slice(0, -1)), 26);
    } else if (isDeleting && displayed.length === 0) {
      setIsDeleting(false);
      setIdx((i) => (i + 1) % searchExamples.length);
    }

    return () => clearTimeout(timeout);
  }, [displayed, isDeleting, idx]);

  return (
    <div
      role="presentation"
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={`flex items-center gap-3 rounded-2xl border px-5 py-4 transition-all duration-300 ${
        focused
          ? "border-white/[0.14] bg-white/[0.06] shadow-[0_0_0_1px_rgba(61,142,98,0.25)]"
          : "border-white/[0.08] bg-white/[0.035]"
      }`}
    >
      <Sparkles size={18} className="shrink-0 text-[#6DD9A4]" strokeWidth={1.75} />
      <span className="min-h-[1.5rem] flex flex-1 items-center text-left text-[15px] leading-snug tracking-tight text-white/88">
        {displayed}
        <span className="ml-0.5 inline-block h-5 w-px animate-pulse bg-[#6DD9A4]" />
      </span>
      <span className="shrink-0 rounded-xl bg-[#3D8E62] px-4 py-2.5 text-sm font-medium text-white shadow-sm shadow-[#3D8E62]/30">
        Search
      </span>
    </div>
  );
}

const cleanupExamples = [
  { raw: "AMZN MKTP US*1X4Y7Z9A2", clean: "Amazon", category: "Shopping", color: "#FF9900" },
  { raw: "UBER* TRIP HELP.UBER.COM CA", clean: "Uber", category: "Transport", color: "#111" },
  { raw: "SQ *SWEETGREEN SAN FRANCISCO", clean: "Sweetgreen", category: "Dining", color: "#006B3F" },
];

function CleanupDemo() {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setRevealed(true), 500);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="space-y-2">
      {cleanupExamples.map((ex, i) => (
        <motion.div
          key={ex.raw}
          initial={{ opacity: 0, x: -6 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ delay: i * 0.07 + 0.1, duration: 0.35 }}
          className="flex items-center gap-3 rounded-xl border border-neutral-200/80 bg-white px-3.5 py-3 shadow-sm"
        >
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
            style={{ backgroundColor: ex.color }}
          >
            {ex.clean[0]}
          </div>
          <div className="min-w-0 flex-1">
            <motion.div
              key={revealed ? "clean" : "raw"}
              initial={{ opacity: 0, y: revealed ? 2 : -2 }}
              animate={{ opacity: 1, y: 0 }}
              className={
                revealed
                  ? "text-sm font-semibold tracking-tight text-neutral-900"
                  : "truncate font-mono text-[11px] text-neutral-400"
              }
            >
              {revealed ? ex.clean : ex.raw}
            </motion.div>
          </div>
          <span className="shrink-0 rounded-full border border-neutral-100 bg-neutral-50 px-2.5 py-0.5 text-[11px] font-medium text-neutral-500">
            {ex.category}
          </span>
          {revealed && (
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 400 }}>
              <Check size={14} className="shrink-0 text-[#3D8E62]" strokeWidth={2.5} />
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
    <div className="overflow-hidden rounded-2xl bg-white text-neutral-900 shadow-[0_32px_80px_-28px_rgba(0,0,0,0.85)] ring-1 ring-black/[0.04]">
      <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="text-lg leading-none">🏔️</span>
          <div>
            <div className="text-sm font-semibold tracking-tight">Weekend trip</div>
            <div className="text-xs text-neutral-400">4 people · $1,087.50</div>
          </div>
        </div>
        <div className="flex -space-x-2">
          {["#3D8E62", "#4A6CF7", "#E8507A", "#F59E0B"].map((c, i) => (
            <div
              key={i}
              className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white text-[11px] font-bold text-white"
              style={{ backgroundColor: c }}
            >
              {["J", "A", "S", "M"][i]}
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-0.5 px-5 py-4">
        {[
          { name: "Alex", owes: 86.0, color: "#4A6CF7" },
          { name: "Sam", owes: -53.33, color: "#E8507A" },
          { name: "Maya", owes: 20.0, color: "#F59E0B" },
        ].map((p) => (
          <div key={p.name} className="flex items-center justify-between py-2 text-sm">
            <div className="flex items-center gap-2.5">
              <div
                className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white"
                style={{ backgroundColor: p.color }}
              >
                {p.name[0]}
              </div>
              <span className="font-medium text-neutral-700">{p.name}</span>
            </div>
            <span
              className={`text-sm font-semibold tabular-nums ${p.owes > 0 ? "text-[#3D8E62]" : "text-red-500"}`}
            >
              {p.owes > 0 ? `owes $${p.owes.toFixed(2)}` : `you owe $${Math.abs(p.owes).toFixed(2)}`}
            </span>
          </div>
        ))}
      </div>
      <div className="border-t border-neutral-100 px-5 py-4">
        <button
          type="button"
          onClick={() => setSettled(!settled)}
          className={`w-full rounded-xl py-3 text-sm font-semibold transition-all ${
            settled
              ? "flex items-center justify-center gap-2 bg-[#EEF7F2] text-[#3D8E62]"
              : "bg-[#3D8E62] text-white hover:bg-[#2D7A52]"
          }`}
        >
          {settled ? (
            <>
              <Check size={16} strokeWidth={2.5} /> All settled
            </>
          ) : (
            <>
              Settle up <ArrowRight className="ml-1 inline h-4 w-4" strokeWidth={2.5} />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function SearchAnswerMock() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
      className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-8 text-left backdrop-blur-sm"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/35">Answer</p>
      <p className="font-display mt-2 text-xl font-semibold tracking-tight text-white">Coffee · past month</p>
      <p className="font-display mt-3 text-5xl font-bold tracking-tight text-[#8EECC0]">$47.20</p>
      <p className="mt-4 text-sm leading-relaxed text-white/45">6 transactions · from your linked accounts</p>
    </motion.div>
  );
}

function TapToPayShowcase() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="relative mx-auto w-full max-w-[270px]"
    >
      <div className="absolute -inset-8 rounded-[2rem] bg-[#3D8E62]/[0.12] blur-3xl" />
      <div className="relative rounded-[1.85rem] border-[2.5px] border-neutral-800 bg-neutral-950 p-2 shadow-2xl shadow-black/50">
        <div className="absolute left-1/2 top-0 z-10 h-[18px] w-[88px] -translate-x-1/2 rounded-b-xl bg-black" />
        <div className="flex min-h-[380px] flex-col overflow-hidden rounded-[1.35rem] bg-gradient-to-b from-[#161816] to-[#0a0b0a] px-5 pb-6 pt-8">
          <div className="mb-5 flex items-center justify-between text-[10px] font-medium text-white/30">
            <span>Coconut</span>
            <span>9:41</span>
          </div>
          <p className="text-center text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">Charge</p>
          <p className="font-display text-center text-4xl font-bold tracking-tight text-white">$42.00</p>
          <p className="mb-8 text-center text-xs text-white/35">In person</p>
          <div className="flex flex-1 flex-col items-center justify-center">
            <div className="relative flex h-[120px] w-[120px] items-center justify-center">
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  className="absolute rounded-full border-2 border-[#6DD9A4]/40"
                  initial={{ width: 52, height: 52, opacity: 0.5 }}
                  animate={{
                    width: [52, 118],
                    height: [52, 118],
                    opacity: [0.45, 0],
                  }}
                  transition={{
                    duration: 2.2,
                    repeat: Infinity,
                    delay: i * 0.55,
                    ease: "easeOut",
                  }}
                />
              ))}
              <div className="relative z-10 flex h-[60px] w-[60px] items-center justify-center rounded-2xl bg-[#3D8E62] shadow-lg shadow-[#3D8E62]/35">
                <Nfc className="h-8 w-8 text-white" strokeWidth={1.75} />
              </div>
            </div>
            <p className="mt-5 text-center text-sm text-white/60">Tap to Pay on iPhone</p>
          </div>
          <div className="mt-auto border-t border-white/[0.06] pt-4">
            <div className="flex h-11 items-center justify-center rounded-xl bg-[#3D8E62] text-sm font-semibold text-white">
              Accept payment
            </div>
            <p className="mt-2 text-center text-[10px] text-white/25">Stripe · sellers</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

const settleBenefits = [
  {
    icon: Wallet,
    title: "Balances that match reality",
    body: "Who owes what stays tied to real expenses — not a group-chat guess.",
  },
  {
    icon: Receipt,
    title: "Tag spend to a shared space",
    body: "Linked accounts keep splits honest when everyone pays from their own card.",
  },
  {
    icon: Check,
    title: "One place to settle",
    body: "Mark it settled and move on. No duplicate spreadsheet per trip.",
  },
];

function BrandMark({ className }: { className?: string }) {
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-2xl bg-white ring-1 ring-white/10 ${className ?? ""}`}
    >
      <Image
        src="/brand/coconut-mark.jpg"
        alt=""
        fill
        sizes="40px"
        className="object-cover"
        priority
      />
    </div>
  );
}

export default function LandingPage() {
  const router = useRouter();
  const appHref = IOS_APP_URL || "/login";

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Nav */}
      <header className="fixed left-0 right-0 top-0 z-50 border-b border-white/[0.06] bg-[#0a0a0a]/75 backdrop-blur-2xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-6">
          <Link href="/" className="flex items-center gap-3">
            <BrandMark className="h-9 w-9 sm:h-10 sm:w-10" />
            <span className="font-display text-lg font-semibold tracking-tight">Coconut</span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => router.push("/login")}
              className="hidden rounded-xl px-3 py-2 text-sm font-medium text-white/55 transition hover:text-white sm:inline"
            >
              Sign in
            </button>
            <a
              href={appHref}
              target={IOS_APP_URL ? "_blank" : undefined}
              rel={IOS_APP_URL ? "noopener noreferrer" : undefined}
              className="inline-flex"
            >
              <span className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-neutral-900 shadow-md transition hover:bg-neutral-100 sm:px-4 sm:py-2.5 sm:text-sm sm:font-semibold">
                App Store
              </span>
            </a>
            <button
              type="button"
              onClick={() => router.push("/connect")}
              className="rounded-xl border border-white/15 px-3 py-2 text-sm font-medium text-white/80 transition hover:border-white/25 hover:bg-white/[0.04] sm:px-4"
            >
              Link bank
            </button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden pt-16">
        <div className="pointer-events-none absolute inset-0" style={gridStyle} />
        <div className="pointer-events-none absolute left-1/2 top-0 h-[min(520px,70vh)] w-[min(900px,140%)] -translate-x-1/2 rounded-full bg-[#3D8E62]/[0.09] blur-[100px]" />

        <div className="relative mx-auto max-w-6xl px-5 pb-20 pt-14 sm:px-6 sm:pb-24 sm:pt-20 lg:pb-28 lg:pt-24">
          <div className="grid items-start gap-16 lg:grid-cols-2 lg:gap-20">
            <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55 }}>
              <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#3D8E62]/35 bg-[#3D8E62]/10 px-4 py-1.5 text-xs font-medium tracking-wide text-[#8EECC0]">
                <span className="text-[#6DD9A4]">#</span>
                Search your money · split with friends · bank in sync
              </p>

              <h1 className="font-display text-[2.35rem] font-bold leading-[1.05] tracking-tight sm:text-5xl lg:text-[3.25rem]">
                Your money,
                <br />
                <span className="bg-gradient-to-r from-[#a8f0c8] to-[#3D8E62] bg-clip-text text-transparent">
                  cleaned up.
                </span>
              </h1>

              <p className="mt-6 max-w-lg text-base leading-relaxed text-white/48 sm:text-[17px]">
                Coconut lives on your iPhone: search spending in plain English, split trips and dinners, and settle
                without spreadsheets. Link your bank in the app — or use the web link below only to connect accounts.
              </p>

              <div className="mt-10 max-w-xl">
                <TypewriterSearchHero />
              </div>

              <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center">
                <AppStoreBadge href={appHref} />
                <button
                  type="button"
                  onClick={() => router.push("/connect")}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/12 bg-transparent px-6 py-3.5 text-sm font-semibold text-white/85 transition hover:border-white/20 hover:bg-white/[0.04]"
                >
                  <Building2 className="h-4 w-4 opacity-70" strokeWidth={2} />
                  Connect bank on web
                </button>
              </div>
              {!IOS_APP_URL && (
                <p className="mt-3 max-w-md text-xs text-white/30">
                  Set <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px]">NEXT_PUBLIC_IOS_APP_URL</code>{" "}
                  to your App Store or TestFlight link for a direct download.
                </p>
              )}

              <div className="mt-10 flex flex-wrap gap-x-8 gap-y-2 text-xs font-medium text-white/32">
                <span className="flex items-center gap-2">
                  <Shield className="h-3.5 w-3.5 text-[#6DD9A4]" strokeWidth={2} />
                  256-bit encryption
                </span>
                <span className="flex items-center gap-2">
                  <Lock className="h-3.5 w-3.5 text-[#6DD9A4]" strokeWidth={2} />
                  Read-only bank access
                </span>
                <span className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-[#6DD9A4]" strokeWidth={2} />
                  No credential storage
                </span>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.06 }}
              className="lg:pt-6"
            >
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#6DD9A4]/90">Settle without the chaos</p>
              <h2 className="font-display mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
                Shared trips &amp; dinners, one honest ledger
              </h2>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-white/42">
                Groups don’t lose track — balances follow real spend, and settling is one tap.
              </p>
              <div className="mt-8">
                <SplitDemo />
              </div>
              <ul className="mt-8 space-y-5">
                {settleBenefits.map(({ icon: Icon, title, body }) => (
                  <li key={title} className="flex gap-4 text-sm text-white/50">
                    <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] ring-1 ring-white/[0.06]">
                      <Icon className="h-[18px] w-[18px] text-[#6DD9A4]" strokeWidth={2} />
                    </span>
                    <span>
                      <span className="font-semibold text-white/90">{title}</span>
                      <span className="mt-1 block leading-relaxed text-white/45">{body}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Search */}
      <section className="relative border-t border-white/[0.06] bg-[#080808] py-20 sm:py-24">
        <div className="pointer-events-none absolute inset-0 opacity-40" style={gridStyle} />
        <div className="relative mx-auto max-w-6xl px-5 sm:px-6">
          <div className="grid items-center gap-14 md:grid-cols-2 md:gap-16">
            <div>
              <h2 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
                Type the way you think — get numbers back
              </h2>
              <p className="mt-5 text-base leading-relaxed text-white/42">
                Time ranges, people, merchants, categories — asked in normal language, answered from the transactions
                you’ve linked. No maze of filters.
              </p>
              <div className="mt-8 flex flex-wrap gap-2">
                {searchExamples.slice(0, 5).map((q) => (
                  <span
                    key={q}
                    className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3.5 py-2 text-xs font-medium text-white/55"
                  >
                    {q}
                  </span>
                ))}
              </div>
            </div>
            <SearchAnswerMock />
          </div>
        </div>
      </section>

      {/* Bank — light band */}
      <section className="border-t border-neutral-200 bg-[#f4f4f5] py-20 text-neutral-900 sm:py-24">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Your bank feed, readable</h2>
            <p className="mt-4 text-base leading-relaxed text-neutral-500">
              Link with Plaid (read-only). Messy descriptors become real merchant names — the same data powers search
              and shared spaces inside the app.
            </p>
          </div>
          <div className="mt-14 grid items-center gap-12 md:grid-cols-2">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="rounded-2xl border border-neutral-200/80 bg-white p-8 shadow-[0_20px_50px_-24px_rgba(0,0,0,0.12)]"
            >
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#EEF7F2]">
                  <Building2 className="h-5 w-5 text-[#3D8E62]" strokeWidth={2} />
                </div>
                <span className="text-xs font-bold uppercase tracking-[0.15em] text-neutral-400">In the app</span>
              </div>
              <h3 className="font-display text-xl font-bold tracking-tight">One sync, many uses</h3>
              <p className="mt-3 text-sm leading-relaxed text-neutral-500">
                Search, cleanup, and splits all read from the same live transaction list — not CSVs and side docs.
              </p>
            </motion.div>
            <div>
              <p className="mb-4 text-xs font-bold uppercase tracking-[0.15em] text-neutral-400">Before → after</p>
              <CleanupDemo />
            </div>
          </div>
        </div>
      </section>

      {/* Tap to Pay */}
      <section className="border-t border-white/[0.06] bg-[#0a0a0a] py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <div className="grid items-center gap-14 lg:grid-cols-2 lg:gap-20">
            <div className="order-2 flex justify-center lg:order-1">
              <TapToPayShowcase />
            </div>
            <div className="order-1 lg:order-2">
              <p className="inline-flex items-center gap-2 rounded-full border border-[#3D8E62]/30 bg-[#3D8E62]/10 px-3 py-1 text-xs font-semibold text-[#8EECC0]">
                <Nfc className="h-3.5 w-3.5" />
                Sellers &amp; side hustles
              </p>
              <h2 className="font-display mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
                Accept contactless payments on iPhone
              </h2>
              <p className="mt-4 text-base leading-relaxed text-white/45">
                Tap to Pay when you sell in person — Stripe-backed, no extra reader. Same account as search and splits.
              </p>
              <ul className="mt-8 space-y-4 text-sm text-white/55">
                <li className="flex gap-3">
                  <Check className="mt-0.5 h-5 w-5 shrink-0 text-[#6DD9A4]" strokeWidth={2.5} />
                  Cards and Apple Pay — customer taps to your phone
                </li>
                <li className="flex gap-3">
                  <Check className="mt-0.5 h-5 w-5 shrink-0 text-[#6DD9A4]" strokeWidth={2.5} />
                  Optional alongside linked banks and group settling
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-white/[0.06] bg-[#080808] py-20 sm:py-24">
        <div className="mx-auto max-w-3xl px-5 text-center sm:px-6">
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl md:text-[2.75rem]">
            Get Coconut on iPhone
          </h2>
          <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-white/42">
            The product is the app — download to search, split, link banks, and use Tap to Pay when you need it.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <AppStoreBadge href={appHref} />
            <button
              type="button"
              onClick={() => router.push("/connect")}
              className="text-sm font-semibold text-white/40 underline-offset-4 transition hover:text-white/60 hover:underline"
            >
              Or connect bank on the web →
            </button>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/[0.06] bg-[#0a0a0a] py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-5 sm:flex-row sm:px-6">
          <div className="flex items-center gap-3">
            <BrandMark className="h-8 w-8" />
            <span className="font-display text-sm font-semibold text-white/80">Coconut</span>
          </div>
          <div className="flex flex-wrap justify-center gap-8 text-sm font-medium text-white/35">
            {["Privacy", "Security", "Terms", "Support"].map((label) => (
              <button key={label} type="button" className="transition hover:text-white/55">
                {label}
              </button>
            ))}
          </div>
          <a
            href={appHref}
            target={IOS_APP_URL ? "_blank" : undefined}
            rel={IOS_APP_URL ? "noopener noreferrer" : undefined}
            className="flex items-center gap-2 text-sm font-medium text-white/45 transition hover:text-white/70"
          >
            <Smartphone className="h-4 w-4" />
            App Store
          </a>
        </div>
      </footer>
    </div>
  );
}

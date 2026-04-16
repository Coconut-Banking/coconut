"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { usePlaidLink } from "react-plaid-link";
import {
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Check,
  CreditCard,
  Search,
  Loader2,
  ArrowLeft,
  Star,
} from "lucide-react";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

interface SpendSummary {
  dining: number;
  travel: number;
  groceries: number;
  gas: number;
  streaming: number;
  transit: number;
  other: number;
  total: number;
  months_analyzed: number;
}

interface QuizAnswers {
  countries: string[];
  max_annual_fee: number;
  networks: string[];
  existing_cards: string[];
  is_business: boolean;
  credit_score_bucket: "excellent" | "good" | "fair" | "poor";
}

interface CardData {
  id: string;
  name: string;
  issuer: string;
  network: string;
  country: string;
  annual_fee: number;
  rewards_program: string;
  rewards_value_cpp: number;
  earn_rates: Record<string, number>;
  sign_up_bonus_value: number;
  sign_up_bonus_spend: number;
  sign_up_bonus_days: number;
  foreign_transaction_fee: boolean;
  key_perks: string[];
  pairs_well_with: string[];
  apply_url?: string | null;
}

interface ValueBreakdown {
  dining: number;
  travel: number;
  groceries: number;
  gas: number;
  streaming: number;
  transit: number;
  other: number;
  annual_fee_cost: number;
  sign_up_bonus_contribution: number;
}

interface Recommendation {
  card_id: string;
  score: number;
  estimated_annual_value: number;
  reason: string;
  value_breakdown?: ValueBreakdown;
  card: CardData | null;
}

type Stage = "entry" | "analyzing" | "quiz" | "recommending" | "results";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

const NETWORK_LABELS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
};

const NETWORK_COLORS: Record<string, string> = {
  visa: "bg-blue-50 text-blue-700 border-blue-200",
  mastercard: "bg-orange-50 text-orange-700 border-orange-200",
  amex: "bg-sky-50 text-sky-700 border-sky-200",
  discover: "bg-amber-50 text-amber-700 border-amber-200",
};

function NetworkBadge({ network }: { network: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${NETWORK_COLORS[network] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}
    >
      {NETWORK_LABELS[network] ?? network}
    </span>
  );
}

function formatCurrency(n: number, country?: string | null) {
  const currency = country === "CA" ? "CAD" : "USD";
  const locale = country === "CA" ? "en-CA" : "en-US";
  return n.toLocaleString(locale, { style: "currency", currency, maximumFractionDigits: 0 });
}

// ──────────────────────────────────────────────────────────────────────────────
// Plaid Link sub-component (must be inside the component that calls usePlaidLink)
// ──────────────────────────────────────────────────────────────────────────────

interface PlaidConnectButtonProps {
  onSuccess: (sessionId: string, spendSummary: SpendSummary, detectedCardIds?: string[]) => void;
  onError: (msg: string) => void;
  compact?: boolean;
  label?: string;
}

function PlaidConnectButton({ onSuccess, onError, compact, label }: PlaidConnectButtonProps) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExchanging, setIsExchanging] = useState(false);

  // Fetch a link token for the cards tool (no auth required)
  const fetchLinkToken = useCallback(async () => {
    setIsLoading(true);
    try {
      const resp = await fetch("/api/cards/create-link-token", { method: "POST" });
      const data = (await resp.json()) as { link_token?: string; error?: string };
      if (!resp.ok || !data.link_token) {
        onError(data.error ?? "Failed to initialize bank connection");
        return;
      }
      setLinkToken(data.link_token);
    } catch {
      onError("Failed to connect to Plaid. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [onError]);

  const handleSuccess = useCallback(
    async (publicToken: string) => {
      setIsExchanging(true);
      try {
        const resp = await fetch("/api/cards/analyze-plaid", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ public_token: publicToken }),
        });
        const data = (await resp.json()) as {
          session_id?: string;
          spend_summary?: SpendSummary;
          detected_card_ids?: string[];
          error?: string;
        };
        if (!resp.ok || !data.session_id || !data.spend_summary) {
          onError(data.error ?? "Failed to analyze your transactions");
          return;
        }
        onSuccess(data.session_id, data.spend_summary, data.detected_card_ids);
      } catch {
        onError("Failed to analyze transactions. Please try again.");
      } finally {
        setIsExchanging(false);
      }
    },
    [onSuccess, onError]
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: handleSuccess,
    onExit: () => {
      setLinkToken(null);
    },
  });

  const handleClick = useCallback(async () => {
    if (ready && linkToken) {
      open();
    } else {
      await fetchLinkToken();
    }
  }, [ready, linkToken, open, fetchLinkToken]);

  // Auto-open once token is ready
  useEffect(() => {
    if (ready && linkToken) {
      open();
    }
  }, [ready, linkToken, open]);

  if (compact) {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={isLoading || isExchanging}
        className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50 transition-colors font-medium"
      >
        {isLoading || isExchanging ? (
          <>
            <Loader2 size={13} className="animate-spin" />
            {isExchanging ? "Analyzing…" : "Connecting…"}
          </>
        ) : (
          <>
            + {label ?? "Add another bank"}
          </>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isLoading || isExchanging}
      className="w-full flex items-center justify-center gap-2 bg-[#1e2021] hover:bg-[#161819] disabled:opacity-60 text-white py-3 px-5 rounded-xl text-sm font-semibold transition-colors"
    >
      {isLoading || isExchanging ? (
        <>
          <Loader2 size={16} className="animate-spin" />
          {isExchanging ? "Analyzing your spending…" : "Connecting…"}
        </>
      ) : (
        <>
          {label ?? "Connect your bank"}
          <ChevronRight size={15} />
        </>
      )}
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Quiz Steps
// ──────────────────────────────────────────────────────────────────────────────

interface QuizStep0Props {
  value: string[];
  onChange: (v: string[]) => void;
}

const COUNTRY_OPTIONS = [
  { label: "🇺🇸 US cards", value: "US" },
  { label: "🇨🇦 Canadian cards", value: "CA" },
];

function Step0Country({ value, onChange }: QuizStep0Props) {
  const toggle = (v: string) => {
    if (value.includes(v)) {
      if (value.length > 1) onChange(value.filter((x) => x !== v));
    } else {
      onChange([...value, v]);
    }
  };
  return (
    <div>
      <h2 className="text-lg font-bold text-gray-900 mb-1">Where do you want a card from?</h2>
      <p className="text-sm text-gray-500 mb-5">Select one or both — we&apos;ll show cards you&apos;re eligible for.</p>
      <div className="flex flex-col gap-3">
        {COUNTRY_OPTIONS.map((opt) => {
          const selected = value.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => toggle(opt.value)}
              className={`flex items-center gap-3 px-4 py-3.5 rounded-xl border-2 text-left transition-all ${selected ? "border-blue-500 bg-blue-50" : "border-gray-200 bg-white hover:border-gray-300"}`}
            >
              <span className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${selected ? "border-blue-500 bg-blue-500" : "border-gray-300"}`}>
                {selected && <Check size={12} className="text-white" />}
              </span>
              <span className={`font-medium text-base ${selected ? "text-blue-700" : "text-gray-700"}`}>{opt.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface QuizStep1Props {
  value: number | null;
  onChange: (v: number) => void;
}

const FEE_OPTIONS = [
  { label: "None ($0)", value: 0 },
  { label: "Up to $95", value: 95 },
  { label: "Up to $250", value: 250 },
  { label: "Up to $550", value: 550 },
  { label: "No limit", value: 9999 },
];

function Step1AnnualFee({ value, onChange }: QuizStep1Props) {
  const [customFee, setCustomFee] = useState<string>("");

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9]/g, "");
    setCustomFee(raw);
    if (raw) onChange(parseInt(raw, 10));
  };

  const activeChip = FEE_OPTIONS.find((o) => o.value === value);

  return (
    <div>
      <h2 className="text-lg font-bold text-gray-900 mb-1">Annual fee preference</h2>
      <p className="text-sm text-gray-500 mb-5">How much are you willing to pay in annual fees?</p>
      <div className="flex flex-wrap gap-2 mb-4">
        {FEE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => { onChange(opt.value); setCustomFee(""); }}
            className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors ${
              value === opt.value && !customFee
                ? "bg-[#1e2021] text-white border-[#1e2021]"
                : "bg-white text-gray-700 border-gray-200 hover:border-gray-400"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500">Or enter a specific amount:</span>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
          <input
            type="number"
            min={0}
            value={customFee}
            onChange={handleCustomChange}
            placeholder="0"
            className={`w-24 pl-7 pr-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e2021]/20 ${
              customFee ? "border-[#1e2021]" : "border-gray-200"
            }`}
          />
        </div>
      </div>
      {!activeChip && !customFee && (
        <p className="mt-1 text-xs text-red-500">Please select or enter an amount</p>
      )}
    </div>
  );
}

interface QuizStep2Props {
  value: string[];
  onChange: (v: string[]) => void;
}

const NETWORK_OPTIONS = [
  { id: "visa", label: "Visa" },
  { id: "mastercard", label: "Mastercard" },
  { id: "amex", label: "American Express" },
  { id: "discover", label: "Discover" },
];

function Step2Networks({ value, onChange }: QuizStep2Props) {
  const toggle = (id: string) => {
    if (value.includes(id)) {
      onChange(value.filter((n) => n !== id));
    } else {
      onChange([...value, id]);
    }
  };

  return (
    <div>
      <h2 className="text-lg font-bold text-gray-900 mb-1">Card networks</h2>
      <p className="text-sm text-gray-500 mb-5">Which card networks are you open to?</p>
      <div className="flex flex-wrap gap-2">
        {NETWORK_OPTIONS.map((opt) => {
          const selected = value.includes(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => toggle(opt.id)}
              className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors flex items-center gap-1.5 ${
                selected
                  ? "bg-[#1e2021] text-white border-[#1e2021]"
                  : "bg-white text-gray-700 border-gray-200 hover:border-gray-400"
              }`}
            >
              {selected && <Check size={13} />}
              {opt.label}
            </button>
          );
        })}
      </div>
      {value.length === 0 && (
        <p className="mt-3 text-xs text-red-500">Please select at least one network</p>
      )}
    </div>
  );
}

interface SimpleCard {
  id: string;
  name: string;
  issuer: string;
  network: string;
  annual_fee: number;
}

interface QuizStep3Props {
  value: string[];
  onChange: (v: string[]) => void;
}

function Step3ExistingCards({ value, onChange }: QuizStep3Props) {
  const [cards, setCards] = useState<SimpleCard[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  const loadCards = useCallback(() => {
    setLoading(true);
    setFetchError(false);
    fetch("/api/cards/list")
      .then((r) => r.json() as Promise<{ cards: SimpleCard[] }>)
      .then((d) => setCards(d.cards ?? []))
      .catch(() => setFetchError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadCards();
  }, [loadCards]);

  const toggle = (id: string) => {
    if (value.includes(id)) {
      onChange(value.filter((c) => c !== id));
    } else {
      onChange([...value, id]);
    }
  };

  const filtered = cards.filter((c) =>
    search === "" ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.issuer.toLowerCase().includes(search.toLowerCase())
  );

  // Group by issuer
  const grouped = filtered.reduce<Record<string, SimpleCard[]>>((acc, card) => {
    if (!acc[card.issuer]) acc[card.issuer] = [];
    acc[card.issuer].push(card);
    return acc;
  }, {});

  return (
    <div>
      <h2 className="text-lg font-bold text-gray-900 mb-1">Cards you already have</h2>
      <p className="text-sm text-gray-500 mb-4">
        {`We won't recommend these — select all that apply.`}
      </p>
      <div className="relative mb-3">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search cards…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e2021]/20"
        />
      </div>
      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 size={20} className="animate-spin text-gray-400" />
        </div>
      ) : fetchError ? (
        <div className="text-center py-6 text-sm text-gray-500">
          <p className="mb-2">Failed to load cards.</p>
          <button type="button" onClick={loadCards} className="text-[#1e2021] font-semibold underline">
            Try again
          </button>
        </div>
      ) : (
        <div className="max-h-64 overflow-y-auto rounded-xl border border-gray-200 divide-y divide-gray-100">
          {Object.entries(grouped).map(([issuer, issuerCards]) => (
            <div key={issuer}>
              <div className="px-3 py-1.5 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {issuer}
              </div>
              {issuerCards.map((card) => {
                const selected = value.includes(card.id);
                return (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => toggle(card.id)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 transition-colors text-left ${selected ? "bg-blue-50" : ""}`}
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-900">{card.name}</p>
                      <p className="text-xs text-gray-500">
                        {card.annual_fee === 0 ? "No annual fee" : `$${card.annual_fee}/yr`} · {NETWORK_LABELS[card.network] ?? card.network}
                      </p>
                    </div>
                    <div
                      className={`w-5 h-5 rounded flex items-center justify-center border ${
                        selected ? "bg-[#1e2021] border-[#1e2021]" : "border-gray-300"
                      }`}
                    >
                      {selected && <Check size={12} className="text-white" />}
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-gray-400">
              No cards found
            </div>
          )}
        </div>
      )}
      {value.length > 0 && (
        <p className="mt-2 text-xs text-gray-500">{value.length} card{value.length > 1 ? "s" : ""} selected</p>
      )}
    </div>
  );
}

interface QuizStep4Props {
  value: boolean | null;
  onChange: (v: boolean) => void;
}

function Step4PersonalBusiness({ value, onChange }: QuizStep4Props) {
  return (
    <div>
      <h2 className="text-lg font-bold text-gray-900 mb-1">Personal or business?</h2>
      <p className="text-sm text-gray-500 mb-5">What type of card are you looking for?</p>
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Personal", value: false, icon: "👤", desc: "For everyday spending" },
          { label: "Business", value: true, icon: "💼", desc: "For business expenses" },
        ].map((opt) => (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`flex flex-col items-center justify-center gap-2 p-6 rounded-2xl border-2 transition-all ${
              value === opt.value
                ? "border-[#1e2021] bg-[#1e2021] text-white"
                : "border-gray-200 bg-white hover:border-gray-400 text-gray-700"
            }`}
          >
            <span className="text-2xl">{opt.icon}</span>
            <span className="font-semibold text-base">{opt.label}</span>
            <span className={`text-xs ${value === opt.value ? "text-gray-300" : "text-gray-500"}`}>
              {opt.desc}
            </span>
          </button>
        ))}
      </div>
      {value === null && (
        <p className="mt-3 text-xs text-red-500">Please select an option</p>
      )}
    </div>
  );
}

interface QuizStep5Props {
  value: QuizAnswers["credit_score_bucket"] | null;
  onChange: (v: QuizAnswers["credit_score_bucket"]) => void;
}

const SCORE_OPTIONS: Array<{ label: string; value: QuizAnswers["credit_score_bucket"]; sub: string }> = [
  { label: "Excellent", value: "excellent", sub: "740+" },
  { label: "Good", value: "good", sub: "670–739" },
  { label: "Fair", value: "fair", sub: "580–669" },
  { label: "Poor", value: "poor", sub: "Below 580" },
];

function Step5CreditScore({ value, onChange }: QuizStep5Props) {
  return (
    <div>
      <h2 className="text-lg font-bold text-gray-900 mb-1">Credit score range</h2>
      <p className="text-sm text-gray-500 mb-5">
        {`What's your approximate credit score?`}
      </p>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {SCORE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`flex items-center justify-between px-4 py-3 rounded-xl border-2 text-left transition-all ${
              value === opt.value
                ? "border-[#1e2021] bg-[#1e2021] text-white"
                : "border-gray-200 bg-white hover:border-gray-400 text-gray-700"
            }`}
          >
            <span className="font-medium text-sm">{opt.label}</span>
            <span className={`text-xs ${value === opt.value ? "text-gray-300" : "text-gray-400"}`}>
              {opt.sub}
            </span>
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-400">
        Most people know this from Credit Karma or their bank app.
      </p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Results Card
// ──────────────────────────────────────────────────────────────────────────────

function ResultCard({
  rec,
  allCards,
  rank,
}: {
  rec: Recommendation;
  allCards: Map<string, CardData>;
  rank: number;
}) {
  const [perksOpen, setPerksOpen] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const card = rec.card;
  if (!card) return null;

  const bd = rec.value_breakdown;
  const CATEGORY_LABELS: Array<[keyof ValueBreakdown, string]> = [
    ["dining", "Dining"],
    ["groceries", "Groceries"],
    ["travel", "Travel"],
    ["gas", "Gas"],
    ["streaming", "Streaming"],
    ["transit", "Transit"],
    ["other", "Everything else"],
  ];
  const spendCategories = bd
    ? CATEGORY_LABELS.filter(([k]) => (bd[k] as number) > 0).map(([k, label]) => ({
        label,
        value: bd[k] as number,
        rate: card.earn_rates[k === "other" ? "base" : k] ?? card.earn_rates["base"] ?? 1,
      }))
    : [];

  const pairNames = card.pairs_well_with
    .map((id) => allCards.get(id)?.name)
    .filter(Boolean)
    .slice(0, 2);

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {rank === 1 && (
                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-semibold rounded-full border border-amber-200">
                  <Star size={10} className="fill-amber-500 text-amber-500" />
                  Top Pick
                </span>
              )}
              <NetworkBadge network={card.network} />
            </div>
            <h3 className="font-bold text-gray-900 text-base leading-tight">{card.name}</h3>
            <p className="text-xs text-gray-500 mt-0.5">{card.issuer}</p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-lg font-bold text-[#1e2021]">
              ~{formatCurrency(rec.estimated_annual_value, card.country)}
            </p>
            <p className="text-xs text-gray-500">est. annual value</p>
          </div>
        </div>
        <p className="text-sm text-gray-600 mt-2 leading-relaxed">{rec.reason}</p>

        {/* Value breakdown */}
        {bd && spendCategories.length > 0 && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setBreakdownOpen((p) => !p)}
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 transition-colors"
            >
              How we get to ~{formatCurrency(rec.estimated_annual_value, card.country)}/yr
              {breakdownOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
            {breakdownOpen && (
              <div className="mt-2 rounded-lg bg-gray-50 border border-gray-100 divide-y divide-gray-100 text-xs">
                {spendCategories.map(({ label, value, rate }) => (
                  <div key={label} className="flex justify-between items-center px-3 py-1.5">
                    <span className="text-gray-600">{label} <span className="text-gray-400">({rate}x)</span></span>
                    <span className="font-medium text-gray-800">+{formatCurrency(value, card.country)}/yr</span>
                  </div>
                ))}
                {bd.annual_fee_cost < 0 && (
                  <div className="flex justify-between items-center px-3 py-1.5">
                    <span className="text-gray-600">Annual fee</span>
                    <span className="font-medium text-red-500">{formatCurrency(bd.annual_fee_cost, card.country)}/yr</span>
                  </div>
                )}
                {bd.sign_up_bonus_contribution > 0 && (
                  <div className="flex justify-between items-center px-3 py-1.5">
                    <span className="text-gray-600">Sign-up bonus <span className="text-gray-400">(amortized)</span></span>
                    <span className="font-medium text-gray-800">+{formatCurrency(bd.sign_up_bonus_contribution, card.country)}/yr</span>
                  </div>
                )}
                <div className="flex justify-between items-center px-3 py-2 bg-white rounded-b-lg font-semibold">
                  <span className="text-gray-700">Total</span>
                  <span className="text-[#1e2021]">~{formatCurrency(rec.estimated_annual_value, card.country)}/yr</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Meta row */}
      <div className="px-5 py-3 flex flex-wrap gap-3 border-b border-gray-100">
        <span className="text-xs text-gray-600">
          <span className="font-medium">Annual fee:</span>{" "}
          {card.annual_fee === 0 ? (
            <span className="text-emerald-600 font-semibold">No fee</span>
          ) : (
            formatCurrency(card.annual_fee, card.country)
          )}
        </span>
        {!card.foreign_transaction_fee ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium border border-emerald-200">
            <Check size={10} />
            No foreign fees
          </span>
        ) : (
          <span className="text-xs text-gray-500">Foreign transaction fee applies</span>
        )}
        {card.sign_up_bonus_value > 0 && (
          <span className="relative group text-xs text-gray-600 cursor-default">
            <span className="font-medium">Sign-up bonus:</span> ~{formatCurrency(card.sign_up_bonus_value, card.country)} value
            {card.sign_up_bonus_spend > 0 && (
              <span className="absolute bottom-full left-0 mb-1.5 z-10 hidden group-hover:block w-56 rounded-lg bg-gray-900 text-white text-xs px-3 py-2 shadow-lg leading-relaxed pointer-events-none">
                Spend {formatCurrency(card.sign_up_bonus_spend, card.country)} in {card.sign_up_bonus_days} days to earn ~{formatCurrency(card.sign_up_bonus_value, card.country)} in rewards value.
                <span className="block text-gray-400 mt-1">Amortized as +{formatCurrency(Math.round(card.sign_up_bonus_value / 3), card.country)}/yr in the estimate above.</span>
              </span>
            )}
          </span>
        )}
      </div>

      {/* Perks */}
      <div className="px-5 py-3">
        <button
          type="button"
          onClick={() => setPerksOpen((p) => !p)}
          className="flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
        >
          Key perks
          {perksOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {perksOpen && (
          <ul className="mt-2 space-y-1.5">
            {card.key_perks.slice(0, 3).map((perk, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                <Check size={13} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                {perk}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Pairs well with */}
      {pairNames.length > 0 && (
        <div className="px-5 py-2 bg-gray-50 border-t border-gray-100 flex flex-wrap gap-1.5 items-center">
          <span className="text-xs text-gray-500">Pairs well with:</span>
          {pairNames.map((name) => (
            <span
              key={name}
              className="px-2 py-0.5 bg-white border border-gray-200 rounded-full text-xs text-gray-600 font-medium"
            >
              {name}
            </span>
          ))}
        </div>
      )}

      {/* CTA */}
      {card.apply_url && (
        <div className="px-5 py-3 border-t border-gray-100">
          <a
            href={card.apply_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full bg-[#1e2021] hover:bg-[#161819] text-white py-2.5 rounded-xl text-sm font-semibold transition-colors"
          >
            Apply for {card.name}
            <ChevronRight size={14} />
          </a>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Main Page (inner — has access to useSearchParams)
// ──────────────────────────────────────────────────────────────────────────────

function CardsPageInner() {
  const searchParams = useSearchParams();
  const isCoconut = searchParams.get("coconut") === "1";

  const [stage, setStage] = useState<Stage>("entry");
  const [quizStep, setQuizStep] = useState(0); // 0-5
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [spendSummary, setSpendSummary] = useState<SpendSummary | null>(null);
  const [banksConnected, setBanksConnected] = useState(0);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [allCardsMap, setAllCardsMap] = useState<Map<string, CardData>>(new Map());
  const [error, setError] = useState<string | null>(null);

  // Quiz answers
  const [countries, setCountries] = useState<string[]>(["US"]);
  const [maxFee, setMaxFee] = useState<number | null>(null);
  const [networks, setNetworks] = useState<string[]>(["visa", "mastercard", "amex", "discover"]);
  const [existingCards, setExistingCards] = useState<string[]>([]);
  const [isBusiness, setIsBusiness] = useState<boolean | null>(null);
  const [creditScore, setCreditScore] = useState<QuizAnswers["credit_score_bucket"] | null>(null);

  // Trigger Coconut analysis on mount if ?coconut=1
  useEffect(() => {
    if (isCoconut && stage === "entry") {
      void triggerCoconutAnalysis();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCoconut]);

  const triggerCoconutAnalysis = async () => {
    setStage("analyzing");
    setError(null);
    try {
      const resp = await fetch("/api/cards/analyze-coconut", { method: "POST" });
      const data = (await resp.json()) as {
        session_id?: string;
        spend_summary?: SpendSummary;
        detected_card_ids?: string[];
        error?: string;
      };
      if (!resp.ok) {
        if (resp.status === 401) {
          // Redirect to sign in
          window.location.href = "/login?redirect_url=/cards%3Fcoconut%3D1";
          return;
        }
        setError(data.error ?? "Failed to analyze your spending");
        setStage("entry");
        return;
      }
      if (!data.session_id || !data.spend_summary) {
        setError(data.error ?? "Failed to analyze your spending");
        setStage("entry");
        return;
      }
      setSessionId(data.session_id);
      setSpendSummary(data.spend_summary);
      // Always overwrite existingCards so stale detections from a prior session don't persist
      setExistingCards(data.detected_card_ids ?? []);
      setStage("quiz");
    } catch {
      setError("Failed to connect. Please try again.");
      setStage("entry");
    }
  };

  const handlePlaidSuccess = (sid: string, summary: SpendSummary, detectedCardIds?: string[]) => {
    setSessionId(sid);
    setSpendSummary(summary);
    // Always overwrite existingCards so stale detections from a prior session don't persist
    setExistingCards(detectedCardIds ?? []);
    setBanksConnected(1);
    setStage("quiz");
  };

  const handleAddBankSuccess = (_sid: string, summary: SpendSummary, detectedCardIds?: string[]) => {
    // Server already merged spend; update state with merged result
    setSpendSummary(summary);
    // Merge detected card IDs (union of both banks)
    setExistingCards((prev) => Array.from(new Set([...prev, ...(detectedCardIds ?? [])])));
    setBanksConnected((n) => n + 1);
  };

  const handlePlaidError = (msg: string) => {
    setError(msg);
  };

  const isStepValid = (): boolean => {
    if (quizStep === 0) return countries.length > 0;
    if (quizStep === 1) return maxFee !== null;
    if (quizStep === 2) return networks.length > 0;
    if (quizStep === 3) return true; // Optional
    if (quizStep === 4) return isBusiness !== null;
    if (quizStep === 5) return creditScore !== null;
    return true;
  };

  const handleNext = async () => {
    if (!isStepValid()) return;
    if (quizStep < 5) {
      setQuizStep((s) => s + 1);
      return;
    }
    // Final step — submit quiz
    await submitQuiz();
  };

  const submitQuiz = async () => {
    if (!sessionId) return;
    setStage("recommending");
    setError(null);

    const quiz: QuizAnswers = {
      countries,
      max_annual_fee: maxFee ?? 9999,
      networks,
      existing_cards: existingCards,
      is_business: isBusiness ?? false,
      credit_score_bucket: creditScore ?? "good",
    };

    try {
      const resp = await fetch("/api/cards/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quiz_answers: quiz }),
      });
      const data = (await resp.json()) as {
        recommendations?: Recommendation[];
        error?: string;
      };
      if (!resp.ok || !data.recommendations) {
        setError(data.error ?? "Failed to generate recommendations");
        setStage("quiz");
        return;
      }
      const recs = data.recommendations;
      setRecommendations(recs);
      // Build cards map
      const map = new Map<string, CardData>();
      for (const rec of recs) {
        if (rec.card) map.set(rec.card.id, rec.card);
      }
      setAllCardsMap(map);
      setStage("results");
    } catch {
      setError("Failed to get recommendations. Please try again.");
      setStage("quiz");
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#F5F3F2]">
      {/* Nav */}
      <div className="px-6 py-4 flex items-center gap-4 border-b border-gray-100 bg-white">
        {stage === "quiz" && (
          <button
            type="button"
            onClick={() => {
              if (quizStep > 0) {
                setQuizStep((s) => s - 1);
              } else {
                setStage("entry");
              }
            }}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            <ArrowLeft size={15} />
            Back
          </button>
        )}
        <div className="flex items-center gap-2.5 mx-auto">
          <img src="/brand/coconut-mark.jpg" alt="Coconut" className="w-6 h-6 rounded-md" />
          <span className="text-sm font-semibold text-gray-700">Coconut</span>
        </div>
        <div className="w-12" />
      </div>

      <div className="max-w-lg mx-auto px-4 py-8">
        {/* ── Stage: Entry ── */}
        {(stage === "entry" || stage === "analyzing") && (
          <div>
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-14 h-14 bg-[#1e2021] rounded-2xl mb-4">
                <CreditCard size={28} className="text-white" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">Find your perfect credit card</h1>
              <p className="text-gray-500 text-sm">Based on how you actually spend money</p>
            </div>

            {error && (
              <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700">
                {error}
              </div>
            )}

            {stage === "analyzing" ? (
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
                <Loader2 size={24} className="animate-spin text-gray-400 mx-auto mb-3" />
                <p className="text-sm font-medium text-gray-700">Analyzing your spending…</p>
                <p className="text-xs text-gray-400 mt-1">
                  This takes a few seconds
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* New user card */}
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 flex flex-col">
                  <div className="w-10 h-10 bg-[#f5f5f5] rounded-xl flex items-center justify-center mb-4">
                    <CreditCard size={20} className="text-[#1e2021]" />
                  </div>
                  <h2 className="font-bold text-gray-900 mb-1">Connect your bank</h2>
                  <p className="text-sm text-gray-500 mb-4 flex-1">
                    Securely link via Plaid to analyze your real spending patterns. Read-only — we never store your credentials.
                  </p>
                  <PlaidConnectButton onSuccess={handlePlaidSuccess} onError={handlePlaidError} />
                </div>

                {/* Existing Coconut user */}
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 flex flex-col">
                  <div className="w-10 h-10 bg-[#1e2021] rounded-xl flex items-center justify-center mb-4">
                    <Check size={20} className="text-white" />
                  </div>
                  <h2 className="font-bold text-gray-900 mb-1">Already a Coconut member?</h2>
                  <p className="text-sm text-gray-500 mb-4 flex-1">
                    Your bank is already connected. Get instant recommendations based on your existing transaction history.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      window.location.href = "/cards?coconut=1";
                    }}
                    className="w-full flex items-center justify-center gap-2 border-2 border-[#1e2021] text-[#1e2021] hover:bg-[#1e2021] hover:text-white py-3 px-5 rounded-xl text-sm font-semibold transition-colors"
                  >
                    Use my Coconut data
                    <ChevronRight size={15} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Stage: Quiz ── */}
        {stage === "quiz" && (
          <div>
            {/* Multi-bank indicator (non-Coconut path only) */}
            {!isCoconut && banksConnected > 0 && (
              <div className="flex items-center justify-between mb-4 px-1">
                <span className="flex items-center gap-1.5 text-xs text-green-700 font-medium">
                  <Check size={13} className="text-green-600" />
                  {banksConnected === 1 ? "1 bank connected" : `${banksConnected} banks connected`}
                </span>
                <PlaidConnectButton
                  onSuccess={handleAddBankSuccess}
                  onError={setError}
                  compact
                />
              </div>
            )}

            {/* Progress bar */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-500 font-medium">Step {quizStep + 1} of 6</span>
                <span className="text-xs text-gray-400">{Math.round(((quizStep + 1) / 6) * 100)}%</span>
              </div>
              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#1e2021] rounded-full transition-all duration-300"
                  style={{ width: `${((quizStep + 1) / 6) * 100}%` }}
                />
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-4">
              {quizStep === 0 && (
                <Step0Country value={countries} onChange={setCountries} />
              )}
              {quizStep === 1 && (
                <Step1AnnualFee value={maxFee} onChange={setMaxFee} />
              )}
              {quizStep === 2 && (
                <Step2Networks value={networks} onChange={setNetworks} />
              )}
              {quizStep === 3 && (
                <Step3ExistingCards value={existingCards} onChange={setExistingCards} />
              )}
              {quizStep === 4 && (
                <Step4PersonalBusiness value={isBusiness} onChange={setIsBusiness} />
              )}
              {quizStep === 5 && (
                <Step5CreditScore value={creditScore} onChange={setCreditScore} />
              )}
            </div>

            {error && (
              <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={handleNext}
              disabled={!isStepValid()}
              className="w-full flex items-center justify-center gap-2 bg-[#1e2021] hover:bg-[#161819] disabled:opacity-50 text-white py-3.5 rounded-xl text-sm font-semibold transition-colors"
            >
              {quizStep === 5 ? "Get my recommendations" : "Continue"}
              <ChevronRight size={15} />
            </button>
          </div>
        )}

        {/* ── Stage: Loading recommendations ── */}
        {stage === "recommending" && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-12 text-center">
            <Loader2 size={28} className="animate-spin text-gray-400 mx-auto mb-4" />
            <p className="text-sm font-medium text-gray-700">Finding your best cards…</p>
            <p className="text-xs text-gray-400 mt-1">Analyzing rewards across 50+ cards</p>
          </div>
        )}

        {/* ── Stage: Results ── */}
        {stage === "results" && (
          <div>
            <div className="mb-6">
              <h1 className="text-xl font-bold text-gray-900 mb-1">Your top card picks</h1>
              {spendSummary && (
                <p className="text-sm text-gray-500">
                  Based on {formatCurrency(spendSummary.total)}/mo across{" "}
                  {Object.entries(spendSummary)
                    .filter(([k, v]) => !["total", "months_analyzed"].includes(k) && (v as number) > 0)
                    .length}{" "}
                  categories
                </p>
              )}
            </div>

            {recommendations.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
                <p className="text-gray-500 text-sm">
                  No cards matched your criteria. Try expanding your annual fee limit or network preferences.
                </p>
                <button
                  type="button"
                  onClick={() => { setStage("quiz"); setQuizStep(0); }}
                  className="mt-4 text-sm font-medium text-[#1e2021] hover:underline"
                >
                  Adjust my answers
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {recommendations.map((rec, i) => (
                  <ResultCard key={rec.card_id} rec={rec} allCards={allCardsMap} rank={i + 1} />
                ))}
              </div>
            )}

            {/* CTA for non-Coconut users */}
            {!isCoconut && (
              <div className="mt-6 bg-emerald-50 border border-emerald-200 rounded-2xl p-5">
                <p className="text-sm font-semibold text-emerald-900 mb-1">
                  Want to track this automatically?
                </p>
                <p className="text-sm text-emerald-800 mb-4">
                  Coconut syncs all your accounts, splits shared expenses with friends, and keeps your finances in one place.
                </p>
                <a
                  href="/connect"
                  className="inline-flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors"
                >
                  Try Coconut free
                  <ChevronRight size={14} />
                </a>
              </div>
            )}

            <button
              type="button"
              onClick={() => { setStage("quiz"); setQuizStep(0); }}
              className="mt-4 w-full text-sm text-gray-500 hover:text-gray-700 transition-colors py-2"
            >
              ← Adjust my answers
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Page export (wrapped in Suspense for useSearchParams)
// ──────────────────────────────────────────────────────────────────────────────

export default function CardsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#F5F3F2] flex items-center justify-center">
          <Loader2 size={24} className="animate-spin text-gray-400" />
        </div>
      }
    >
      <CardsPageInner />
    </Suspense>
  );
}

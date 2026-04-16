/**
 * Credit card recommendation engine.
 * Pure functions — no I/O, fully testable.
 */

export interface SpendProfile {
  dining: number;      // monthly avg in dollars
  travel: number;
  groceries: number;
  gas: number;
  streaming: number;
  transit: number;
  other: number;
}

export interface QuizAnswers {
  countries: string[];          // e.g. ["US"] or ["CA"]
  max_annual_fee: number;       // 0, 95, 250, 550, or 9999 (no limit)
  networks: string[];           // ["visa","mastercard"] or ["visa","mastercard","amex","discover"]
  existing_cards: string[];     // card IDs they already have
  is_business: boolean;
  credit_score_bucket: "excellent" | "good" | "fair" | "poor";
}

export interface CreditCard {
  id: string;
  name: string;
  issuer: string;
  network: string;
  country?: string | null;
  annual_fee: number;
  rewards_program: string;
  rewards_value_cpp: number;
  earn_rates: Record<string, number>;
  sign_up_bonus_value: number;
  sign_up_bonus_spend: number;
  sign_up_bonus_days: number;
  foreign_transaction_fee: boolean;
  credit_score_minimum: number;
  is_business: boolean;
  key_perks: string[];
  pairs_well_with: string[];
  image_url?: string | null;
  apply_url?: string | null;
  active: boolean;
}

export interface ValueBreakdown {
  dining: number;
  travel: number;
  groceries: number;
  gas: number;
  streaming: number;
  transit: number;
  other: number;
  annual_fee_cost: number;       // negative number, e.g. -95
  sign_up_bonus_contribution: number; // amortized 1/3 of bonus value
}

export interface CardRecommendation {
  card_id: string;
  score: number;
  estimated_annual_value: number; // in dollars
  reason: string; // one personalized sentence
  value_breakdown: ValueBreakdown;
  upgrade_from?: string; // e.g. "vs your current average of $X back"
}

/** Map credit score bucket to a minimum score value for filtering.
 *  Cards with credit_score_minimum > this value are excluded.
 *  Ranges align with standard FICO tiers so mid-tier cards (700 req.)
 *  correctly appear for "good" users and ultra-premium cards (750 req.)
 *  appear for "excellent" users. */
const CREDIT_SCORE_MAP: Record<QuizAnswers["credit_score_bucket"], number> = {
  excellent: 760, // 740+ FICO — qualifies for virtually every card including ultra-premium
  good: 700,      // 670–739 FICO — qualifies for most standard and mid-premium cards
  fair: 640,      // 580–669 FICO — qualifies for entry-level, student and secured cards
  poor: 580,      // <580 FICO — secured / no-credit-check cards only
};

/**
 * Calculate the estimated annual value of a card for a given spend profile.
 * Returns net value in dollars after annual fee, plus a per-category breakdown.
 */
function calculateAnnualValue(card: CreditCard, spend: SpendProfile): { total: number; breakdown: ValueBreakdown } {
  const rates = card.earn_rates;
  const cpp = Number(card.rewards_value_cpp);

  const cats: Array<[keyof SpendProfile & keyof ValueBreakdown, string]> = [
    ["dining", "dining"],
    ["travel", "travel"],
    ["groceries", "groceries"],
    ["gas", "gas"],
    ["streaming", "streaming"],
    ["transit", "transit"],
  ];

  const breakdown: ValueBreakdown = {
    dining: 0, travel: 0, groceries: 0, gas: 0, streaming: 0, transit: 0,
    other: 0, annual_fee_cost: -card.annual_fee, sign_up_bonus_contribution: Math.round(card.sign_up_bonus_value / 3),
  };

  for (const [spendKey, rateKey] of cats) {
    const monthly = spend[spendKey] ?? 0;
    const rate = rates[rateKey] ?? rates["base"] ?? 1;
    breakdown[spendKey] = Math.round(monthly * rate * (cpp / 100) * 12);
  }
  breakdown.other = Math.round((spend.other ?? 0) * (rates["base"] ?? 1) * (cpp / 100) * 12);

  const total =
    breakdown.dining + breakdown.travel + breakdown.groceries + breakdown.gas +
    breakdown.streaming + breakdown.transit + breakdown.other +
    breakdown.annual_fee_cost + breakdown.sign_up_bonus_contribution;

  return { total, breakdown };
}

/**
 * Build a personalized one-sentence reason for recommending a card.
 */
function buildReason(card: CreditCard, spend: SpendProfile, annualValue: number, _breakdown?: ValueBreakdown): string {
  const rates = card.earn_rates;
  const cpp = Number(card.rewards_value_cpp);

  // Find the category where this card earns the most for this user
  type SpendCat = { label: string; key: keyof SpendProfile; rateKey: string };
  const cats: SpendCat[] = [
    { label: "dining", key: "dining", rateKey: "dining" },
    { label: "groceries", key: "groceries", rateKey: "groceries" },
    { label: "travel", key: "travel", rateKey: "travel" },
    { label: "gas", key: "gas", rateKey: "gas" },
    { label: "streaming", key: "streaming", rateKey: "streaming" },
    { label: "transit", key: "transit", rateKey: "transit" },
    { label: "everyday purchases", key: "other", rateKey: "base" },
  ];

  let bestCat: SpendCat | null = null;
  let bestEarnings = 0;

  for (const cat of cats) {
    const monthly = spend[cat.key] ?? 0;
    const rate = rates[cat.rateKey] ?? rates["base"] ?? 1;
    const earnings = monthly * rate * (cpp / 100) * 12;
    if (earnings > bestEarnings && monthly > 0) {
      bestEarnings = earnings;
      bestCat = cat;
    }
  }

  const currencyPrefix = card.country === "CA" ? "CA$" : "$";
  const netStr = `~${currencyPrefix}${Math.round(annualValue)}/year`;

  if (bestCat && bestEarnings > 0) {
    const rateForCat = rates[bestCat.rateKey] ?? rates["base"] ?? 1;
    const multiplierStr = rateForCat >= 2
      ? `${rateForCat}x on ${bestCat.label}`
      : `solid rewards on ${bestCat.label}`;
    return `With your ${bestCat.label} spend, the ${multiplierStr} earns you ${netStr} net after the ${currencyPrefix}${card.annual_fee} annual fee.`;
  }

  if (card.annual_fee === 0) {
    return `A no-fee card that earns ${netStr} on your spending with no commitments.`;
  }

  return `Estimated to return ${netStr} net after the ${currencyPrefix}${card.annual_fee} annual fee based on your spending.`;
}

/**
 * Main recommendation function.
 * Returns up to 5 ranked CardRecommendation objects.
 */
export function getCardRecommendations(
  cards: CreditCard[],
  spend: SpendProfile,
  quiz: QuizAnswers,
  topN = 5
): CardRecommendation[] {
  const userCreditScore = CREDIT_SCORE_MAP[quiz.credit_score_bucket];

  // Filter cards
  const eligible = cards.filter((card) => {
    // Exclude cards the user already has
    if (quiz.existing_cards.includes(card.id)) return false;

    // Annual fee limit
    if (quiz.max_annual_fee !== 9999 && card.annual_fee > quiz.max_annual_fee) return false;

    // Network preference
    if (quiz.networks.length > 0 && !quiz.networks.includes(card.network)) return false;

    // Country eligibility
    if (quiz.countries.length > 0 && !quiz.countries.includes(card.country ?? "US")) return false;

    // Business vs personal
    if (card.is_business !== quiz.is_business) return false;

    // Credit score
    if (card.credit_score_minimum > userCreditScore) return false;

    return true;
  });

  // Score each card
  const scored = eligible.map((card) => {
    const { total: annualValue, breakdown } = calculateAnnualValue(card, spend);
    const reason = buildReason(card, spend, annualValue);
    return {
      card_id: card.id,
      score: annualValue,
      estimated_annual_value: Math.round(annualValue),
      reason,
      value_breakdown: breakdown,
    } satisfies CardRecommendation;
  });

  // Sort descending by estimated_annual_value
  scored.sort((a, b) => b.estimated_annual_value - a.estimated_annual_value);

  return scored.slice(0, topN);
}

/**
 * Categorize Plaid transactions into the 7 spend profile buckets.
 * Handles both Plaid's personal_finance_category and legacy category arrays.
 */
/**
 * Match Plaid credit card account names to known card IDs.
 * Used to pre-populate the "cards you already have" step.
 */
export interface PlaidAccountForMatching {
  name: string;
  official_name?: string | null;
  institution_name?: string | null;
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ABBREV_MAP: Record<string, string> = {
  "amex": "american express",
  "boa": "bank of america",
  "bofa": "bank of america",
};

function expandAbbreviations(s: string): string {
  let result = s;
  for (const [abbrev, full] of Object.entries(ABBREV_MAP)) {
    result = result.replace(new RegExp(`\\b${abbrev}\\b`, "gi"), full);
  }
  return result;
}

export function matchPlaidAccountsToCards(
  accounts: PlaidAccountForMatching[],
  cards: CreditCard[]
): string[] {
  const matched = new Set<string>();

  for (const account of accounts) {
    const rawName = account.official_name ?? account.name;
    const inst = account.institution_name ?? "";
    const combined = normalizeName(expandAbbreviations(`${inst} ${rawName}`));

    for (const card of cards) {
      const cardNorm = normalizeName(expandAbbreviations(card.name));
      const issuerNorm = normalizeName(expandAbbreviations(card.issuer));

      const stopWords = new Set(["card", "credit", "rewards", "visa", "mastercard", "the"]);
      // Exclude issuer words so "american" + "express" don't count as card-specific matches
      const issuerWords = new Set(issuerNorm.split(" ").filter((w) => w.length > 2));
      const cardWords = cardNorm
        .split(" ")
        .filter((w) => w.length > 2 && !stopWords.has(w) && !issuerWords.has(w));

      const matchCount = cardWords.filter((w) => combined.includes(w)).length;
      const issuerMatch =
        combined.includes(issuerNorm) ||
        issuerNorm.split(" ").some((w) => w.length > 3 && combined.includes(w));
      const isMatch =
        (issuerMatch && cardWords.length > 0 && matchCount >= Math.min(1, cardWords.length)) ||
        combined.includes(cardNorm);

      if (isMatch) {
        matched.add(card.id);
        break;
      }
    }
  }

  return Array.from(matched);
}

export interface PlaidTransactionRow {
  amount: number;
  primary_category?: string | null;
  detailed_category?: string | null;
  merchant_name?: string | null;
  raw_name?: string | null;
}

export function categorizeTransactions(
  transactions: PlaidTransactionRow[],
  monthsAnalyzed: number
): SpendProfile & { total: number; months_analyzed: number } {
  const totals = {
    dining: 0,
    travel: 0,
    groceries: 0,
    gas: 0,
    streaming: 0,
    transit: 0,
    other: 0,
  };

  for (const tx of transactions) {
    // Only count positive amounts (expenses, not income)
    if (tx.amount <= 0) continue;

    const primary = (tx.primary_category ?? "").toUpperCase();
    const detailed = (tx.detailed_category ?? "").toUpperCase();
    const combined = `${primary} ${detailed}`.trim();

    let category: keyof typeof totals = "other";

    if (
      combined.includes("RESTAURANT") ||
      combined.includes("FOOD_AND_DRINK") ||
      combined.includes("DINING") ||
      combined.includes("FAST_FOOD") ||
      combined.includes("COFFEE") ||
      combined.includes("ALCOHOL") ||
      detailed.includes("RESTAURANTS")
    ) {
      category = "dining";
    } else if (
      combined.includes("GROCERIES") ||
      combined.includes("SUPERMARKET") ||
      combined.includes("GROCERY")
    ) {
      category = "groceries";
    } else if (
      combined.includes("GAS_AND_FUEL") ||
      combined.includes("GAS STATIONS") ||
      combined.includes("FUEL")
    ) {
      category = "gas";
    } else if (
      combined.includes("STREAMING") ||
      combined.includes("SUBSCRIPTIONS") ||
      combined.includes("DIGITAL_SUBSCRIPTIONS")
    ) {
      category = "streaming";
    } else if (
      combined.includes("TRAVEL") ||
      combined.includes("AIRLINES") ||
      combined.includes("LODGING") ||
      combined.includes("HOTELS") ||
      combined.includes("RENTAL_CARS")
    ) {
      category = "travel";
    } else if (
      combined.includes("TRANSIT") ||
      combined.includes("TRANSPORTATION") ||
      combined.includes("RIDESHARE") ||
      combined.includes("PARKING") ||
      combined.includes("PUBLIC_TRANSIT")
    ) {
      category = "transit";
    }

    totals[category] += tx.amount;
  }

  const months = monthsAnalyzed || 1;

  return {
    dining: Math.round(totals.dining / months),
    travel: Math.round(totals.travel / months),
    groceries: Math.round(totals.groceries / months),
    gas: Math.round(totals.gas / months),
    streaming: Math.round(totals.streaming / months),
    transit: Math.round(totals.transit / months),
    other: Math.round(totals.other / months),
    total: Math.round(
      (totals.dining + totals.travel + totals.groceries + totals.gas +
        totals.streaming + totals.transit + totals.other) / months
    ),
    months_analyzed: months,
  };
}

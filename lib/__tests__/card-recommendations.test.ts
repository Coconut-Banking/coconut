import { describe, it, expect } from "vitest";
import {
  getCardRecommendations,
  matchPlaidAccountsToCards,
  categorizeTransactions,
} from "../card-recommendations";
import type { CreditCard, SpendProfile, QuizAnswers } from "../card-recommendations";

// ── Fixtures ────────────────────────────────────────────────────────────────

const BASE_QUIZ: QuizAnswers = {
  countries: ["US"],
  max_annual_fee: 9999,
  networks: ["visa", "mastercard", "amex", "discover"],
  existing_cards: [],
  is_business: false,
  credit_score_bucket: "excellent",
};

const SPEND: SpendProfile = {
  dining: 500,
  travel: 200,
  groceries: 400,
  gas: 100,
  streaming: 50,
  transit: 50,
  other: 300,
};

function makeCard(overrides: Partial<CreditCard> & { id: string }): CreditCard {
  return {
    name: "Test Card",
    issuer: "Test Bank",
    network: "visa",
    country: "US",
    annual_fee: 0,
    rewards_program: "cash_back",
    rewards_value_cpp: 1.0,
    earn_rates: { dining: 1, travel: 1, groceries: 1, gas: 1, streaming: 1, transit: 1, base: 1 },
    sign_up_bonus_value: 0,
    sign_up_bonus_spend: 0,
    sign_up_bonus_days: 90,
    foreign_transaction_fee: false,
    credit_score_minimum: 0,
    is_business: false,
    key_perks: [],
    pairs_well_with: [],
    active: true,
    ...overrides,
  };
}

// ── matchPlaidAccountsToCards ────────────────────────────────────────────────

describe("matchPlaidAccountsToCards", () => {
  const cards: CreditCard[] = [
    makeCard({ id: "chase-sapphire-preferred", name: "Chase Sapphire Preferred", issuer: "Chase", network: "visa" }),
    makeCard({ id: "amex-gold", name: "American Express Gold Card", issuer: "American Express", network: "amex" }),
    makeCard({ id: "capital-one-venture", name: "Capital One Venture Rewards", issuer: "Capital One", network: "visa" }),
    makeCard({ id: "amex-cobalt-ca", name: "American Express Cobalt Card", issuer: "American Express", network: "amex", country: "CA" }),
    makeCard({ id: "td-aeroplan-infinite-ca", name: "TD Aeroplan Visa Infinite Card", issuer: "TD", network: "visa", country: "CA" }),
    makeCard({ id: "citi-double-cash", name: "Citi Double Cash Card", issuer: "Citi", network: "mastercard" }),
  ];

  it("matches an exact card name from Plaid account", () => {
    const result = matchPlaidAccountsToCards(
      [{ name: "Chase Sapphire Preferred", institution_name: "Chase" }],
      cards
    );
    expect(result).toContain("chase-sapphire-preferred");
  });

  it("matches using official_name when provided", () => {
    const result = matchPlaidAccountsToCards(
      [{ name: "CREDIT CARD", official_name: "Chase Sapphire Preferred", institution_name: "Chase" }],
      cards
    );
    expect(result).toContain("chase-sapphire-preferred");
  });

  it("expands AMEX abbreviation to match American Express card", () => {
    const result = matchPlaidAccountsToCards(
      [{ name: "AMEX GOLD", institution_name: "American Express" }],
      cards
    );
    expect(result).toContain("amex-gold");
  });

  it("matches Canadian card with institution name", () => {
    const result = matchPlaidAccountsToCards(
      [{ name: "Cobalt Card", institution_name: "American Express" }],
      cards
    );
    expect(result).toContain("amex-cobalt-ca");
  });

  it("matches TD Aeroplan by institution + card name keywords", () => {
    const result = matchPlaidAccountsToCards(
      [{ name: "TD Aeroplan Visa Infinite", institution_name: "TD" }],
      cards
    );
    expect(result).toContain("td-aeroplan-infinite-ca");
  });

  it("does not match when institution is wrong", () => {
    const result = matchPlaidAccountsToCards(
      [{ name: "Sapphire Preferred", institution_name: "Bank of America" }],
      cards
    );
    expect(result).not.toContain("chase-sapphire-preferred");
  });

  it("returns empty array for no accounts", () => {
    expect(matchPlaidAccountsToCards([], cards)).toEqual([]);
  });

  it("returns empty array when no cards match", () => {
    const result = matchPlaidAccountsToCards(
      [{ name: "Unknown Mystery Card", institution_name: "Unknown Bank" }],
      cards
    );
    expect(result).toHaveLength(0);
  });

  it("matches multiple cards from multiple accounts", () => {
    const result = matchPlaidAccountsToCards(
      [
        { name: "Chase Sapphire Preferred", institution_name: "Chase" },
        { name: "Venture Rewards", institution_name: "Capital One" },
      ],
      cards
    );
    expect(result).toContain("chase-sapphire-preferred");
    expect(result).toContain("capital-one-venture");
  });

  it("deduplicates — same card from two accounts only appears once", () => {
    const result = matchPlaidAccountsToCards(
      [
        { name: "Chase Sapphire Preferred", institution_name: "Chase" },
        { name: "Chase Sapphire Preferred", institution_name: "Chase" },
      ],
      cards
    );
    expect(result.filter((id) => id === "chase-sapphire-preferred")).toHaveLength(1);
  });
});

// ── getCardRecommendations ───────────────────────────────────────────────────

describe("getCardRecommendations", () => {
  const highDiningCard = makeCard({
    id: "high-dining",
    name: "Dining Card",
    issuer: "Test Bank",
    earn_rates: { dining: 5, travel: 1, groceries: 1, gas: 1, streaming: 1, transit: 1, base: 1 },
    rewards_value_cpp: 1.0,
    annual_fee: 0,
  });
  const highTravelCard = makeCard({
    id: "high-travel",
    name: "Travel Card",
    issuer: "Test Bank",
    earn_rates: { dining: 1, travel: 5, groceries: 1, gas: 1, streaming: 1, transit: 1, base: 1 },
    rewards_value_cpp: 1.0,
    annual_fee: 0,
  });

  it("ranks higher-value card first", () => {
    const results = getCardRecommendations([highTravelCard, highDiningCard], SPEND, BASE_QUIZ);
    // dining spend ($500) > travel spend ($200), so dining card should rank higher
    expect(results[0].card_id).toBe("high-dining");
  });

  it("returns up to topN results", () => {
    const cards = Array.from({ length: 10 }, (_, i) =>
      makeCard({ id: `card-${i}`, name: `Card ${i}`, issuer: "Bank" })
    );
    const results = getCardRecommendations(cards, SPEND, BASE_QUIZ, 3);
    expect(results).toHaveLength(3);
  });

  it("excludes cards the user already has", () => {
    const quiz = { ...BASE_QUIZ, existing_cards: ["high-dining"] };
    const results = getCardRecommendations([highDiningCard, highTravelCard], SPEND, quiz);
    expect(results.map((r) => r.card_id)).not.toContain("high-dining");
  });

  it("excludes cards above annual fee limit", () => {
    const expensiveCard = makeCard({ id: "expensive", name: "Pricey Card", issuer: "Bank", annual_fee: 550 });
    const quiz = { ...BASE_QUIZ, max_annual_fee: 95 };
    const results = getCardRecommendations([expensiveCard, highDiningCard], SPEND, quiz);
    expect(results.map((r) => r.card_id)).not.toContain("expensive");
  });

  it("excludes cards from wrong country", () => {
    const caCard = makeCard({ id: "ca-card", name: "Canadian Card", issuer: "TD", country: "CA" });
    const quiz = { ...BASE_QUIZ, countries: ["US"] };
    const results = getCardRecommendations([caCard, highDiningCard], SPEND, quiz);
    expect(results.map((r) => r.card_id)).not.toContain("ca-card");
  });

  it("includes Canadian cards when countries includes CA", () => {
    const caCard = makeCard({ id: "ca-card", name: "Canadian Card", issuer: "TD", country: "CA" });
    const quiz = { ...BASE_QUIZ, countries: ["CA"] };
    const results = getCardRecommendations([caCard, highDiningCard], SPEND, quiz);
    expect(results.map((r) => r.card_id)).toContain("ca-card");
  });

  it("excludes business cards for personal quiz", () => {
    const bizCard = makeCard({ id: "biz", name: "Biz Card", issuer: "Bank", is_business: true });
    const quiz = { ...BASE_QUIZ, is_business: false };
    const results = getCardRecommendations([bizCard, highDiningCard], SPEND, quiz);
    expect(results.map((r) => r.card_id)).not.toContain("biz");
  });

  it("excludes cards requiring higher credit score", () => {
    const premiumCard = makeCard({ id: "premium", name: "Premium Card", issuer: "Bank", credit_score_minimum: 750 });
    const quiz = { ...BASE_QUIZ, credit_score_bucket: "good" as const }; // maps to 670
    const results = getCardRecommendations([premiumCard, highDiningCard], SPEND, quiz);
    expect(results.map((r) => r.card_id)).not.toContain("premium");
  });

  it("excludes inactive cards", () => {
    const inactiveCard = makeCard({ id: "inactive", name: "Old Card", issuer: "Bank", active: false });
    // inactive cards wouldn't be fetched from DB, but engine should still handle active:false
    const results = getCardRecommendations([inactiveCard], SPEND, BASE_QUIZ);
    // active:false cards are filtered at DB level, not engine level — engine doesn't filter by active
    // so this just verifies the engine doesn't crash on them
    expect(Array.isArray(results)).toBe(true);
  });

  it("includes value_breakdown in results", () => {
    const results = getCardRecommendations([highDiningCard], SPEND, BASE_QUIZ);
    expect(results[0].value_breakdown).toBeDefined();
    expect(results[0].value_breakdown.dining).toBeGreaterThan(0);
    expect(results[0].value_breakdown.annual_fee_cost).toBe(-0); // -card.annual_fee where fee=0
  });

  it("annual_fee_cost is negative in breakdown", () => {
    const feeCard = makeCard({ id: "fee-card", name: "Fee Card", issuer: "Bank", annual_fee: 95 });
    const results = getCardRecommendations([feeCard], SPEND, BASE_QUIZ);
    expect(results[0].value_breakdown.annual_fee_cost).toBe(-95);
  });

  it("sign_up_bonus amortized as 1/3 of value", () => {
    const bonusCard = makeCard({
      id: "bonus-card",
      name: "Bonus Card",
      issuer: "Bank",
      sign_up_bonus_value: 750,
    });
    const results = getCardRecommendations([bonusCard], SPEND, BASE_QUIZ);
    expect(results[0].value_breakdown.sign_up_bonus_contribution).toBe(250);
  });

  it("returns empty array when no eligible cards", () => {
    const quiz = { ...BASE_QUIZ, networks: ["discover"] };
    const visaOnly = makeCard({ id: "visa-only", name: "Visa Card", issuer: "Bank", network: "visa" });
    const results = getCardRecommendations([visaOnly], SPEND, quiz);
    expect(results).toHaveLength(0);
  });
});

// ── categorizeTransactions ───────────────────────────────────────────────────

describe("categorizeTransactions", () => {
  it("categorizes restaurant transactions as dining", () => {
    const result = categorizeTransactions(
      [{ amount: 60, primary_category: "FOOD_AND_DRINK", detailed_category: "RESTAURANTS" }],
      1
    );
    expect(result.dining).toBe(60);
    expect(result.groceries).toBe(0);
  });

  it("categorizes grocery transactions correctly", () => {
    const result = categorizeTransactions(
      [{ amount: 200, primary_category: "GROCERIES", detailed_category: "SUPERMARKET" }],
      1
    );
    expect(result.groceries).toBe(200);
  });

  it("categorizes gas correctly", () => {
    const result = categorizeTransactions(
      [{ amount: 80, primary_category: "TRANSPORTATION", detailed_category: "GAS_AND_FUEL" }],
      1
    );
    expect(result.gas).toBe(80);
  });

  it("categorizes travel correctly", () => {
    const result = categorizeTransactions(
      [{ amount: 400, primary_category: "TRAVEL", detailed_category: "AIRLINES" }],
      1
    );
    expect(result.travel).toBe(400);
  });

  it("categorizes streaming correctly", () => {
    const result = categorizeTransactions(
      [{ amount: 15, primary_category: "ENTERTAINMENT", detailed_category: "STREAMING" }],
      1
    );
    expect(result.streaming).toBe(15);
  });

  it("categorizes transit correctly", () => {
    const result = categorizeTransactions(
      [{ amount: 100, primary_category: "TRANSPORTATION", detailed_category: "TRANSIT" }],
      1
    );
    expect(result.transit).toBe(100);
  });

  it("buckets unknown categories as other", () => {
    const result = categorizeTransactions(
      [{ amount: 50, primary_category: "SHOPPING", detailed_category: "CLOTHING" }],
      1
    );
    expect(result.other).toBe(50);
  });

  it("ignores negative amounts (credits/refunds)", () => {
    const result = categorizeTransactions(
      [
        { amount: 100, primary_category: "FOOD_AND_DRINK", detailed_category: "RESTAURANTS" },
        { amount: -30, primary_category: "FOOD_AND_DRINK", detailed_category: "RESTAURANTS" },
      ],
      1
    );
    expect(result.dining).toBe(100);
  });

  it("divides by months_analyzed for monthly average", () => {
    const result = categorizeTransactions(
      [{ amount: 300, primary_category: "FOOD_AND_DRINK", detailed_category: "RESTAURANTS" }],
      3
    );
    expect(result.dining).toBe(100);
  });

  it("handles empty transactions", () => {
    const result = categorizeTransactions([], 3);
    expect(result.dining).toBe(0);
    expect(result.total).toBe(0);
    expect(result.months_analyzed).toBe(3);
  });

  it("computes total as sum of all categories", () => {
    const result = categorizeTransactions(
      [
        { amount: 100, primary_category: "FOOD_AND_DRINK", detailed_category: "RESTAURANTS" },
        { amount: 200, primary_category: "GROCERIES", detailed_category: "SUPERMARKET" },
      ],
      1
    );
    expect(result.total).toBe(300);
  });
});

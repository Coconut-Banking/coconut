/**
 * Integration tests for the full email receipt pipeline:
 *   Gmail API (mocked) → parseReceiptEmail (OpenAI mocked) → Supabase insert → match to transactions
 *
 * Covers:
 *  - Pre-filters: excluded senders, Amazon shipped/delivered emails
 *  - Merchant types: Starbucks (SQ * POS), Amazon (AMZN* tx), DoorDash, Spotify, Square restaurant
 *  - Duplicate skipping: already-processed message IDs not re-parsed
 *  - Match quality: correct transaction linked, NOT same-amount decoy
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── vi.hoisted runs BEFORE vi.mock factories and module evaluation ─────────────
// Use it to: (1) set env so OpenAI client initializes, (2) build a mutable
// create-mock that the OpenAI constructor can close over.
const openaiMocks = vi.hoisted(() => {
  process.env.OPENAI_API_KEY = "test-key-for-vitest";

  // Mutable reference — tests swap this via setCreate()
  let _create: (...args: unknown[]) => unknown = async () => ({
    choices: [{ message: { content: '{"not_receipt":true}' } }],
  });

  // Regular function (not arrow) so it works with `new OpenAI()`
  function OpenAIMock(this: unknown) {
    return {
      chat: { completions: { create: (...args: unknown[]) => _create(...args) } },
    };
  }

  return {
    OpenAIMock,
    setCreate: (fn: typeof _create) => { _create = fn; },
    resetCreate: () => {
      _create = async () => ({
        choices: [{ message: { content: '{"not_receipt":true}' } }],
      });
    },
  };
});

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("openai", () => ({ default: openaiMocks.OpenAIMock }));
vi.mock("../google-auth", () => ({ getGmailClient: vi.fn() }));
vi.mock("../supabase",    () => ({ getSupabase: vi.fn() }));
vi.mock("../retry", () => ({
  withRetry: vi.fn((fn: () => unknown) => fn()),
  mapWithConcurrency: vi.fn(async (items: unknown[], fn: (item: unknown) => Promise<void>) => {
    for (const item of items) await fn(item);
  }),
}));

import { getGmailClient } from "../google-auth";
import { getSupabase }    from "../supabase";
import { withRetry, mapWithConcurrency } from "../retry";

// ── Fake email bodies ──────────────────────────────────────────────────────────

// Unique anchor strings used in setupParse() to route to the right parsed result
const ANCHORS = {
  starbucks: "STARBUCKS-RECEIPT-ANCHOR",
  amazon:    "AMAZON-RECEIPT-ANCHOR",
  doordash:  "DOORDASH-RECEIPT-ANCHOR",
  spotify:   "SPOTIFY-RECEIPT-ANCHOR",
  mensho:    "MENSHO-RECEIPT-ANCHOR",
};

const EMAIL = {
  starbucks: `<h1>Starbucks Receipt ${ANCHORS.starbucks}</h1>
    <p>Date: April 10, 2026</p>
    <p>Grande Latte $6.25 | Blueberry Muffin $3.50 | Tax $0.85</p>
    <p><strong>Total $10.60</strong></p>`,

  amazon: `<h1>Amazon Order Confirmation ${ANCHORS.amazon}</h1>
    <p>Order #112-5551234-9876543 placed April 11, 2026</p>
    <p>Apple USB-C Cable $14.99 | Phone Stand $12.99 | Tax $2.52</p>
    <p><strong>Order Total $30.50</strong></p>`,

  doordash: `<h1>DoorDash Receipt ${ANCHORS.doordash}</h1>
    <p>April 12, 2026 — Burma Bites</p>
    <p>Chicken Noodle Soup $13.00 | Spring Rolls $9.00</p>
    <p>Delivery $2.99 | Service fee $3.30 | Tip $5.00</p>
    <p><strong>Total $33.29</strong></p>`,

  spotify: `<p>Spotify Premium subscription renewed April 13, 2026 ${ANCHORS.spotify}</p>
    <p><strong>Amount charged $11.99</strong></p>`,

  mensho: `<h2>Receipt from Mensho Tokyo SF ${ANCHORS.mensho}</h2>
    <p>April 9, 2026 — Ramen Tonkotsu $22.00 | Soft Drink $4.00 | Tax $2.34</p>
    <p><strong>Total $28.34</strong></p>`,

  investment: `<p>Your buy order for 10 shares of AAPL executed. Total $1,720.00</p>`,

  amazonShipped: `<p>Your Amazon order has shipped! Tracking: 1Z999AA1</p>`,
};

// ── OpenAI parsed results (what the LLM would return) ────────────────────────

const PARSED = {
  starbucks: { merchant: "Starbucks", order_date: "2026-04-10", total_amount: 10.60, subtotal: 9.75, tax: 0.85, order_number: null, line_items: [{ name: "Grande Latte", quantity: 1, unit_price: 6.25, total: 6.25, category: "FOOD_AND_DRINK" }, { name: "Blueberry Muffin", quantity: 1, unit_price: 3.50, total: 3.50, category: "FOOD_AND_DRINK" }, { name: "Tax", quantity: 1, unit_price: 0.85, total: 0.85, category: "FOOD_AND_DRINK" }] },
  amazon:    { merchant: "Amazon", order_date: "2026-04-11", total_amount: 30.50, subtotal: 27.98, tax: 2.52, order_number: "112-5551234-9876543", line_items: [{ name: "USB-C Cable", quantity: 1, unit_price: 14.99, total: 14.99, category: "ELECTRONICS" }, { name: "Phone Stand", quantity: 1, unit_price: 12.99, total: 12.99, category: "ELECTRONICS" }, { name: "Tax", quantity: 1, unit_price: 2.52, total: 2.52, category: "ELECTRONICS" }] },
  doordash:  { merchant: "DoorDash", order_date: "2026-04-12", total_amount: 33.29, subtotal: 22.00, tax: null, order_number: null, line_items: [{ name: "Chicken Noodle Soup", quantity: 1, unit_price: 13.00, total: 13.00, category: "FOOD_AND_DRINK" }, { name: "Spring Rolls", quantity: 1, unit_price: 9.00, total: 9.00, category: "FOOD_AND_DRINK" }, { name: "Fees & Tip", quantity: 1, unit_price: 11.29, total: 11.29, category: "FOOD_AND_DRINK" }] },
  spotify:   { merchant: "Spotify", order_date: "2026-04-13", total_amount: 11.99, subtotal: null, tax: null, order_number: null, line_items: [{ name: "Spotify Premium", quantity: 1, unit_price: 11.99, total: 11.99, category: "ENTERTAINMENT" }] },
  mensho:    { merchant: "Mensho Tokyo SF", order_date: "2026-04-09", total_amount: 28.34, subtotal: 26.00, tax: 2.34, order_number: null, line_items: [{ name: "Ramen Tonkotsu", quantity: 1, unit_price: 22.00, total: 22.00, category: "FOOD_AND_DRINK" }, { name: "Soft Drink", quantity: 1, unit_price: 4.00, total: 4.00, category: "FOOD_AND_DRINK" }, { name: "Tax", quantity: 1, unit_price: 2.34, total: 2.34, category: "FOOD_AND_DRINK" }] },
};

// ── Fake Plaid transactions ────────────────────────────────────────────────────

const FAKE_TXS = [
  { id: "tx-sbux",    amount: 10.60, date: "2026-04-10", normalized_merchant: "starbucks",  merchant_name: "STARBUCKS #12345" },
  { id: "tx-amzn",    amount: 30.50, date: "2026-04-12", normalized_merchant: "amzn mktp",  merchant_name: "AMZN*MKTP US" },
  { id: "tx-dd",      amount: 33.29, date: "2026-04-13", normalized_merchant: "doordash",   merchant_name: "DOORDASH*BURMA" },
  { id: "tx-spotify", amount: 11.99, date: "2026-04-13", normalized_merchant: "spotify",    merchant_name: "SPOTIFY USA" },
  { id: "tx-mensho",  amount: 28.34, date: "2026-04-10", normalized_merchant: "mensho",     merchant_name: "SQ *MENSHO" },
  // Decoy: same amount as Spotify, same day, different merchant
  { id: "tx-decoy",   amount: 11.99, date: "2026-04-13", normalized_merchant: "hulu",       merchant_name: "HULU" },
];

// ── Gmail mock factory ─────────────────────────────────────────────────────────

function makeMsg(id: string, from: string, subject: string, body: string) {
  return {
    data: {
      id,
      payload: {
        headers: [{ name: "From", value: from }, { name: "Subject", value: subject }],
        mimeType: "text/html",
        body: { data: Buffer.from(body).toString("base64url") },
      },
    },
  };
}

const MSGS: Record<string, ReturnType<typeof makeMsg>> = {
  "msg-sbux":    makeMsg("msg-sbux",    "no-reply@starbucks.com",   "Your Starbucks receipt",              EMAIL.starbucks),
  "msg-amazon":  makeMsg("msg-amazon",  "order-update@amazon.com",  "Ordered: Your Amazon order #112-555", EMAIL.amazon),
  "msg-dd":      makeMsg("msg-dd",      "receipts@doordash.com",    "Your DoorDash receipt",               EMAIL.doordash),
  "msg-spotify": makeMsg("msg-spotify", "no-reply@spotify.com",     "Your Spotify receipt",                EMAIL.spotify),
  "msg-mensho":  makeMsg("msg-mensho",  "no-reply@squareup.com",    "Your receipt from Mensho Tokyo SF",   EMAIL.mensho),
  "msg-invest":  makeMsg("msg-invest",  "noreply@questrade.com",    "Buy order executed: AAPL",            EMAIL.investment),
  "msg-shipped": makeMsg("msg-shipped", "order-update@amazon.com",  "Your Amazon order has shipped!",      EMAIL.amazonShipped),
};

function gmail(ids: string[]) {
  return {
    users: {
      messages: {
        list: vi.fn().mockResolvedValue({ data: { messages: ids.map((id) => ({ id })) } }),
        get: vi.fn().mockImplementation(async ({ id }: { id: string }) => {
          if (!MSGS[id]) throw new Error(`Unknown msg id: ${id}`);
          return MSGS[id];
        }),
      },
    },
  };
}

// ── Supabase stub ──────────────────────────────────────────────────────────────

function makeDb(alreadyDone: string[] = []) {
  const insertedReceipts: Record<string, unknown>[] = [];
  const updatedMatches: Array<{ id: string; transaction_id: string }> = [];
  let counter = 0;

  function chain(val: unknown) {
    const q: Record<string, unknown> = {};
    const s = () => q;
    q.select = s; q.eq = s; q.in = s; q.is = s;
    q.not = s; q.gte = s; q.lte = s; q.maybeSingle = s;
    q.then = (res: (v: unknown) => void) => { res(val); return Promise.resolve(val); };
    return q;
  }

  const db = {
    from: (table: string) => ({
      select: (_cols?: string) => ({
        // direct .in() — used by matchReceiptsToTransactions on email_receipts
        in: (_c: string, ids: string[]) => ({
          is: (_c2: string, _v2: unknown) => {
            if (table === "email_receipts") {
              const matched = insertedReceipts.filter((r) => ids.includes((r as Record<string,unknown>).id as string));
              return chain({ data: matched, error: null });
            }
            return chain({ data: [], error: null });
          },
        }),
        eq: (_c: string, _v: unknown) => ({
          in: (_c2: string, ids: string[]) => {
            if (table === "email_receipts" || table === "gmail_scan_log") {
              const hits = ids.filter((id) => alreadyDone.includes(id));
              return chain({ data: hits.map((id) => ({ gmail_message_id: id })), error: null });
            }
            if (table === "transactions") {
              return chain({ data: FAKE_TXS.filter((tx) => ids.includes(tx.id)), error: null });
            }
            return chain({ data: [], error: null });
          },
          is:  (_c2: string, _v2: unknown) => chain({ data: [], error: null }),
          not: (_c2: string, _op: string, _v2: unknown) => chain({ data: [], error: null }),
          gte: (_c2: string, _v2: unknown) => ({
            lte: (_c3: string, _v3: unknown) => chain({ data: FAKE_TXS, error: null }),
          }),
        }),
        maybeSingle: () => chain({ data: null, error: null }),
      }),
      insert: (rows: unknown) => {
        if (table === "email_receipts") {
          const arr = Array.isArray(rows) ? rows : [rows];
          const inserted = arr.map((r) => ({ ...r as object, id: `receipt-${++counter}` }));
          inserted.forEach((r) => insertedReceipts.push(r));
          return { select: () => chain({ data: inserted, error: null }) };
        }
        return chain({ data: null, error: null });
      },
      update: (patch: Record<string, unknown>) => ({
        eq: (_c: string, id: unknown) => {
          if (table === "email_receipts" && patch.transaction_id) {
            updatedMatches.push({ id: id as string, transaction_id: patch.transaction_id as string });
          }
          return chain({ data: null, error: null });
        },
        in: () => chain({ data: null, error: null }),
      }),
      upsert: (rows: unknown, _opts?: unknown) => {
        if (table === "email_receipts") {
          const arr = Array.isArray(rows) ? rows : [rows];
          const inserted = arr.map((r) => ({ ...r as object, id: `receipt-${++counter}` }));
          inserted.forEach((r) => insertedReceipts.push(r));
          return { select: (_cols?: string) => chain({ data: inserted, error: null }) };
        }
        return { select: () => chain({ data: null, error: null }) };
      },
    }),
  };

  return { db, insertedReceipts, updatedMatches };
}

// ── OpenAI response builder ────────────────────────────────────────────────────

/** Sets up OpenAI mock to return the first matching parsed result based on body substring. */
function setupParse(map: Array<[key: string, result: Record<string, unknown> | null]>) {
  openaiMocks.setCreate(async (req: unknown) => {
    const content = (req as { messages: Array<{ content: string }> }).messages[0]?.content ?? "";
    let result: Record<string, unknown> | null = null;
    for (const [key, val] of map) {
      if (content.includes(key)) { result = val; break; }
    }
    return { choices: [{ message: { content: result == null ? '{"not_receipt":true}' : JSON.stringify(result) } }] };
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("Email receipt pipeline — full integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openaiMocks.resetCreate();
    // Re-establish retry mock implementations wiped by vi.clearAllMocks()
    (withRetry as ReturnType<typeof vi.fn>).mockImplementation((fn: () => unknown) => fn());
    (mapWithConcurrency as ReturnType<typeof vi.fn>).mockImplementation(
      async <T>(items: T[], fn: (item: T, index: number) => Promise<unknown>) => {
        const results = [];
        for (let i = 0; i < items.length; i++) results.push(await fn(items[i], i));
        return results;
      }
    );
  });

  async function scan(...args: Parameters<Awaited<ReturnType<typeof getScanFn>>>) {
    const fn = await getScanFn();
    return fn(...args);
  }

  async function getScanFn() {
    // Dynamic import so module re-evaluates with hoisted env + mocked OpenAI
    const mod = await import("../receipt-parser");
    return mod.scanGmailForReceipts;
  }

  // ── Pre-filters ──────────────────────────────────────────────────────────────

  describe("Pre-filters", () => {
    it("skips investment emails (questrade.com is excluded sender)", async () => {
      const { db, insertedReceipts } = makeDb();
      (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue(db);
      (getGmailClient as ReturnType<typeof vi.fn>).mockResolvedValue(gmail(["msg-invest"]));

      const stats = await scan("user_test", 30, false, true);

      expect(stats.notReceipt).toBe(1);
      expect(stats.parsed).toBe(0);
      expect(insertedReceipts).toHaveLength(0);
    });

    it("skips Amazon shipped emails (only 'Ordered:' subject parsed)", async () => {
      const { db, insertedReceipts } = makeDb();
      (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue(db);
      (getGmailClient as ReturnType<typeof vi.fn>).mockResolvedValue(gmail(["msg-shipped"]));

      const stats = await scan("user_test", 30, false, true);

      expect(stats.notReceipt).toBe(1);
      expect(insertedReceipts).toHaveLength(0);
    });

    it("skips already-processed IDs when forceRescan=false", async () => {
      const { db } = makeDb(["msg-sbux", "msg-spotify"]);
      (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue(db);
      (getGmailClient as ReturnType<typeof vi.fn>).mockResolvedValue(
        gmail(["msg-sbux", "msg-spotify", "msg-amazon"])
      );
      setupParse([[ANCHORS.amazon, PARSED.amazon]]);

      const stats = await scan("user_test", 30, false, false);

      expect(stats.alreadyProcessed).toBe(2);
      expect(stats.parsed).toBe(1); // only Amazon
    });
  });

  // ── Parsing ──────────────────────────────────────────────────────────────────

  describe("Parsing", () => {
    it("parses Starbucks receipt — correct merchant, amount, date", async () => {
      const { db, insertedReceipts } = makeDb();
      (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue(db);
      (getGmailClient as ReturnType<typeof vi.fn>).mockResolvedValue(gmail(["msg-sbux"]));
      setupParse([[ANCHORS.starbucks, PARSED.starbucks]]);

      const stats = await scan("user_test", 30, false, true);

      expect(stats.parsed).toBe(1);
      expect(stats.insertErrors).toBe(0);
      expect(insertedReceipts[0]).toMatchObject({ merchant: "Starbucks", amount: 10.60, date: "2026-04-10" });
    });

    it("parses Amazon receipt — includes order_number", async () => {
      const { db, insertedReceipts } = makeDb();
      (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue(db);
      (getGmailClient as ReturnType<typeof vi.fn>).mockResolvedValue(gmail(["msg-amazon"]));
      setupParse([[ANCHORS.amazon, PARSED.amazon]]);

      await scan("user_test", 30, false, true);

      expect(insertedReceipts[0]).toMatchObject({ merchant: "Amazon", amount: 30.50, order_number: "112-5551234-9876543" });
    });

    it("parses DoorDash delivery receipt", async () => {
      const { db, insertedReceipts } = makeDb();
      (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue(db);
      (getGmailClient as ReturnType<typeof vi.fn>).mockResolvedValue(gmail(["msg-dd"]));
      setupParse([[ANCHORS.doordash, PARSED.doordash]]);

      await scan("user_test", 30, false, true);

      expect(insertedReceipts[0]).toMatchObject({ merchant: "DoorDash", amount: 33.29 });
    });

    it("parses Spotify subscription receipt", async () => {
      const { db, insertedReceipts } = makeDb();
      (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue(db);
      (getGmailClient as ReturnType<typeof vi.fn>).mockResolvedValue(gmail(["msg-spotify"]));
      setupParse([[ANCHORS.spotify, PARSED.spotify]]);

      await scan("user_test", 30, false, true);

      expect(insertedReceipts[0]).toMatchObject({ merchant: "Spotify", amount: 11.99 });
    });
  });

  // ── Matching ──────────────────────────────────────────────────────────────────

  describe("Matching", () => {
    it("matches Starbucks receipt to STARBUCKS transaction", async () => {
      const { db, updatedMatches } = makeDb();
      (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue(db);
      (getGmailClient as ReturnType<typeof vi.fn>).mockResolvedValue(gmail(["msg-sbux"]));
      setupParse([[ANCHORS.starbucks, PARSED.starbucks]]);

      const stats = await scan("user_test", 30, false, true);

      expect(stats.matched).toBe(1);
      expect(updatedMatches.some((m) => m.transaction_id === "tx-sbux")).toBe(true);
    });

    it("matches Amazon receipt to AMZN*MKTP US transaction (POS prefix stripped)", async () => {
      const { db, updatedMatches } = makeDb();
      (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue(db);
      (getGmailClient as ReturnType<typeof vi.fn>).mockResolvedValue(gmail(["msg-amazon"]));
      setupParse([[ANCHORS.amazon, PARSED.amazon]]);

      const stats = await scan("user_test", 30, false, true);

      expect(stats.matched).toBe(1);
      expect(updatedMatches.some((m) => m.transaction_id === "tx-amzn")).toBe(true);
    });

    it("matches Spotify receipt to SPOTIFY USA — NOT the $11.99 Hulu decoy on same day", async () => {
      const { db, updatedMatches } = makeDb();
      (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue(db);
      (getGmailClient as ReturnType<typeof vi.fn>).mockResolvedValue(gmail(["msg-spotify"]));
      setupParse([[ANCHORS.spotify, PARSED.spotify]]);

      const stats = await scan("user_test", 30, false, true);

      expect(stats.matched).toBe(1);
      expect(updatedMatches.some((m) => m.transaction_id === "tx-spotify")).toBe(true);
      expect(updatedMatches.some((m) => m.transaction_id === "tx-decoy")).toBe(false);
    });

    it("matches Mensho Tokyo SF receipt to SQ *MENSHO transaction (POS prefix stripping)", async () => {
      const { db, updatedMatches } = makeDb();
      (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue(db);
      (getGmailClient as ReturnType<typeof vi.fn>).mockResolvedValue(gmail(["msg-mensho"]));
      setupParse([[ANCHORS.mensho, PARSED.mensho]]);

      const stats = await scan("user_test", 30, false, true);

      expect(stats.matched).toBe(1);
      expect(updatedMatches.some((m) => m.transaction_id === "tx-mensho")).toBe(true);
    });

    it("batch: all 5 receipts parsed and each matched to the correct transaction", async () => {
      const { db, insertedReceipts, updatedMatches } = makeDb();
      (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue(db);
      (getGmailClient as ReturnType<typeof vi.fn>).mockResolvedValue(
        gmail(["msg-sbux", "msg-amazon", "msg-dd", "msg-spotify", "msg-mensho"])
      );
      setupParse([
        [ANCHORS.starbucks, PARSED.starbucks],
        [ANCHORS.amazon,    PARSED.amazon],
        [ANCHORS.doordash,  PARSED.doordash],
        [ANCHORS.spotify,   PARSED.spotify],
        [ANCHORS.mensho,    PARSED.mensho],
      ]);

      const stats = await scan("user_test", 30, false, true);

      expect(stats.parsed).toBe(5);
      expect(stats.insertErrors).toBe(0);
      expect(insertedReceipts).toHaveLength(5);
      expect(stats.matched).toBe(5);
      expect(updatedMatches.some((m) => m.transaction_id === "tx-sbux")).toBe(true);
      expect(updatedMatches.some((m) => m.transaction_id === "tx-amzn")).toBe(true);
      expect(updatedMatches.some((m) => m.transaction_id === "tx-dd")).toBe(true);
      expect(updatedMatches.some((m) => m.transaction_id === "tx-spotify")).toBe(true);
      expect(updatedMatches.some((m) => m.transaction_id === "tx-mensho")).toBe(true);
    });
  });

  // ── Scan stats ────────────────────────────────────────────────────────────────

  describe("Scan stats", () => {
    it("counts notReceipt + parsed correctly in a mixed batch", async () => {
      const { db } = makeDb();
      (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue(db);
      (getGmailClient as ReturnType<typeof vi.fn>).mockResolvedValue(
        gmail(["msg-sbux", "msg-invest", "msg-shipped"])
      );
      setupParse([[ANCHORS.starbucks, PARSED.starbucks]]);

      const stats = await scan("user_test", 30, false, true);

      expect(stats.emailsFetched).toBe(3);
      expect(stats.parsed).toBe(1);     // Starbucks only
      expect(stats.notReceipt).toBe(2); // investment + shipped
    });
  });
});

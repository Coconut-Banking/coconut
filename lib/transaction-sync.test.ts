/**
 * Tests that embedRichTransactionsForUser and embedTransactionsForUser
 * check the error response from Supabase .update() calls.
 *
 * BUG-RESILIENCE-1: Previously these functions discarded the { data, error }
 * tuple returned by Supabase, silently ignoring DB write failures.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Mock openai so the module-level `openai` variable is non-null ---
vi.mock("openai", () => {
  const mockCreate = vi.fn().mockResolvedValue({
    data: [{ embedding: [0.1, 0.2, 0.3] }],
  });
  class MockOpenAI {
    embeddings = { create: mockCreate };
    constructor(_opts: unknown) {}
  }
  return { default: MockOpenAI };
});

// --- Mock external dependencies that are not under test ---
vi.mock("./plaid-client", () => ({ getPlaidClient: vi.fn() }));
vi.mock("./encryption", () => ({
  encryptToken: vi.fn(),
  decryptToken: vi.fn(),
}));
vi.mock("./rate-limit", () => ({ rateLimit: vi.fn().mockResolvedValue(true) }));

// We'll control what getSupabase returns via this variable.
let mockDb: ReturnType<typeof buildMockDb>;

function buildMockDb(updateError: { message: string } | null) {
  const eqForUpdate = vi.fn().mockResolvedValue({ data: null, error: updateError });
  const updateFn = vi.fn().mockReturnValue({ eq: eqForUpdate });

  const eqForSelect = vi.fn().mockReturnThis();
  const isForSelect = vi.fn().mockReturnThis();
  const limitForSelect = vi.fn().mockResolvedValue({
    data: [
      {
        id: "tx-1",
        merchant_name: "Coffee Shop",
        raw_name: "COFFEE SHOP",
        normalized_merchant: "coffee shop",
        primary_category: "Food",
        detailed_category: "Coffee",
        amount: 5.0,
        date: "2026-01-01",
        is_pending: false,
        account_id: null,
      },
    ],
    error: null,
  });

  // accounts select (for embedRich)
  const eqForAccountsSelect = vi.fn().mockResolvedValue({ data: [], error: null });

  const fromMock = vi.fn().mockImplementation((table: string) => {
    if (table === "accounts") {
      return {
        select: vi.fn().mockReturnValue({ eq: eqForAccountsSelect }),
      };
    }
    // transactions table
    return {
      select: vi.fn().mockReturnValue({
        eq: eqForSelect,
        is: isForSelect,
        limit: limitForSelect,
      }),
      update: updateFn,
    };
  });

  return { from: fromMock, updateFn, eqForUpdate };
}

vi.mock("./supabase", () => ({
  getSupabase: vi.fn(() => mockDb),
  getSupabaseAdmin: vi.fn(() => mockDb),
  getSupabaseForUser: vi.fn(() => mockDb),
}));

// Set OPENAI_API_KEY so the module initialises openai as non-null
const originalKey = process.env.OPENAI_API_KEY;
beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-key";
  vi.resetModules();
});
afterEach(() => {
  process.env.OPENAI_API_KEY = originalKey;
});

describe("BUG-RESILIENCE-1: embedding functions check Supabase update errors", () => {
  it("embedTransactionsForUser logs a warning when update returns an error", async () => {
    const updateError = { message: "db write failed" };
    mockDb = buildMockDb(updateError);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Dynamic import so that vi.mock factories above are already applied
    const { embedTransactionsForUser } = await import("./transaction-sync");

    await embedTransactionsForUser("user-123");

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[embed]"),
      "tx-1",
      ":",
      "db write failed"
    );

    warnSpy.mockRestore();
  });

  it("embedRichTransactionsForUser logs a warning when update returns an error", async () => {
    const updateError = { message: "rich db write failed" };
    mockDb = buildMockDb(updateError);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { embedRichTransactionsForUser } = await import("./transaction-sync");

    await embedRichTransactionsForUser("user-123");

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[embed-rich]"),
      "tx-1",
      ":",
      "rich db write failed"
    );

    warnSpy.mockRestore();
  });

  it("embedTransactionsForUser does NOT warn when update succeeds", async () => {
    mockDb = buildMockDb(null);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { embedTransactionsForUser } = await import("./transaction-sync");

    await embedTransactionsForUser("user-123");

    const embedWarn = warnSpy.mock.calls.filter((args) =>
      typeof args[0] === "string" && args[0].includes("[embed]")
    );
    expect(embedWarn).toHaveLength(0);

    warnSpy.mockRestore();
  });
});

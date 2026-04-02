export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import { getMaxSettlementAllowed } from "@/lib/group-balances";
import { normalizeSplitCurrency } from "@/lib/split-balances-currency";
import { canAccessGroup } from "@/lib/group-access";
import { getUserId } from "@/lib/auth";
import { CACHE_TAGS } from "@/lib/cached-queries";

interface SettlementInput {
  payerMemberId: string;
  receiverMemberId: string;
  amount: number;
  currency?: string;
  method?: string;
}

/**
 * POST /api/settlements/batch
 * Records all suggested settlements for a group atomically.
 * Body: { groupId: string, settlements: SettlementInput[] }
 *
 * Each settlement is validated against the current max allowed amount to prevent
 * over-settling. If any settlement is invalid, the entire batch is rejected.
 * Inserted sequentially (not in a DB transaction) to reuse per-settlement validation.
 *
 * Returns: { settled: number, skipped: number, results: { ok, id?, error }[] }
 */
export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { groupId?: string; settlements?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const groupId = body.groupId;
  const settlements = body.settlements;

  if (!groupId || !Array.isArray(settlements) || settlements.length === 0) {
    return NextResponse.json(
      { error: "groupId and non-empty settlements array required" },
      { status: 400 }
    );
  }

  if (settlements.length > 50) {
    return NextResponse.json({ error: "Maximum 50 settlements per batch" }, { status: 400 });
  }

  const canAccess = await canAccessGroup(userId, groupId);
  if (!canAccess) return NextResponse.json({ error: "Group not found" }, { status: 404 });

  // Validate all inputs before touching DB
  const inputs: SettlementInput[] = [];
  for (const s of settlements) {
    if (!s || typeof s !== "object") {
      return NextResponse.json({ error: "Each settlement must be an object" }, { status: 400 });
    }
    const item = s as Record<string, unknown>;
    const payerMemberId = typeof item.payerMemberId === "string" ? item.payerMemberId : null;
    const receiverMemberId = typeof item.receiverMemberId === "string" ? item.receiverMemberId : null;
    const amount = Number(item.amount);
    if (!payerMemberId || !receiverMemberId || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { error: "Each settlement requires payerMemberId, receiverMemberId, and amount > 0" },
        { status: 400 }
      );
    }
    inputs.push({
      payerMemberId,
      receiverMemberId,
      amount,
      currency: typeof item.currency === "string" ? item.currency : "USD",
      method: typeof item.method === "string" ? item.method : "manual",
    });
  }

  const db = getSupabase();
  const results: { ok: boolean; id?: string; error?: string }[] = [];
  let settled = 0;
  let skipped = 0;

  for (const input of inputs) {
    const currency = normalizeSplitCurrency(input.currency ?? "USD");
    const method = ["manual", "in_person", "online"].includes(input.method ?? "")
      ? input.method!
      : "manual";

    const { maxAmount, allowed, reason } = await getMaxSettlementAllowed(
      groupId,
      input.payerMemberId,
      input.receiverMemberId,
      currency
    );

    if (!allowed || maxAmount <= 0) {
      results.push({ ok: false, error: reason ?? "Nothing to settle" });
      skipped++;
      continue;
    }

    const amountToInsert = Math.min(Math.round(input.amount * 100) / 100, maxAmount);

    const { data: settlement, error } = await db
      .from("settlements")
      .insert({
        group_id: groupId,
        payer_member_id: input.payerMemberId,
        receiver_member_id: input.receiverMemberId,
        amount: amountToInsert,
        method,
        status: "completed",
        iso_currency_code: currency,
      })
      .select()
      .single();

    if (error) {
      console.error("[settlements/batch] insert:", error.message);
      results.push({ ok: false, error: "Insert failed" });
      skipped++;
      continue;
    }

    // Post-insert race check: undo if we over-settled
    const postCheck = await getMaxSettlementAllowed(
      groupId,
      input.payerMemberId,
      input.receiverMemberId,
      currency
    );
    if (postCheck.maxAmount < 0) {
      await db.from("settlements").delete().eq("id", settlement.id);
      results.push({ ok: false, error: "Race condition detected — skipped" });
      skipped++;
      continue;
    }

    results.push({ ok: true, id: settlement.id });
    settled++;
  }

  revalidateTag(CACHE_TAGS.splitTransactions(userId), "max");

  return NextResponse.json({ settled, skipped, results });
}

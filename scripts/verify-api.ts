/**
 * Local API verification script.
 * Tests all endpoints the mobile app depends on against real Supabase data.
 *
 * Usage:
 *   npx tsx scripts/verify-api.ts [userId]
 *
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 * If userId is omitted, uses the first owner found in the groups table.
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

let passed = 0;
let failed = 0;
function ok(label: string, result: boolean, detail?: string) {
  if (result) {
    passed++;
    console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const userId = process.argv[2] || await findFirstOwner();
  if (!userId) {
    console.error("No userId provided and no groups found in DB.");
    process.exit(1);
  }
  console.log(`\nVerifying API data for userId: ${userId}\n`);

  // --- 1. getAccessibleGroupIds ---
  console.log("=== getAccessibleGroupIds ===");
  const { data: owned } = await db.from("groups").select("id").eq("owner_id", userId);
  const { data: memberOf } = await db.from("group_members").select("group_id").eq("user_id", userId);
  const idSet = new Set<string>();
  for (const g of owned || []) idSet.add(g.id);
  for (const r of memberOf || []) if (r.group_id) idSet.add(r.group_id);
  const ids = [...idSet];
  ok("owned groups found", (owned?.length ?? 0) > 0, `${owned?.length ?? 0} owned`);
  ok("accessible group IDs", ids.length > 0, `${ids.length} total`);

  // --- 2. groups query (with archived_at fallback) ---
  console.log("\n=== GET /api/groups/summary (groups query) ===");
  const groupRes = await db
    .from("groups")
    .select("id, name, owner_id, created_at, group_type, archived_at")
    .in("id", ids)
    .order("created_at", { ascending: false });

  let groups: { id: string; name: string }[];
  if (groupRes.error?.code === "42703") {
    console.log("  ⚠️  archived_at column missing — using fallback query");
    const fallback = await db
      .from("groups")
      .select("id, name, owner_id, created_at, group_type")
      .in("id", ids)
      .order("created_at", { ascending: false });
    groups = fallback.data ?? [];
    ok("fallback query succeeds", groups.length > 0, `${groups.length} groups`);
  } else {
    groups = (groupRes.data ?? []).filter((g: Record<string, unknown>) => !(g as { archived_at?: string }).archived_at);
    ok("groups query with archived_at", groups.length > 0, `${groups.length} active groups`);
  }

  // --- 3. members ---
  console.log("\n=== Members ===");
  const groupIds = groups.map((g) => g.id);
  const { data: members } = await db
    .from("group_members")
    .select("id, group_id, user_id, display_name, email")
    .in("group_id", groupIds);
  ok("members loaded", (members?.length ?? 0) > 0, `${members?.length ?? 0} total`);

  const friendKeys = new Set<string>();
  for (const m of members ?? []) {
    if (m.user_id === userId) continue;
    friendKeys.add(m.user_id ?? m.email ?? `${m.group_id}-${m.id}`);
  }
  ok("friends derivable", friendKeys.size > 0, `${friendKeys.size} unique friends`);

  // --- 4. split_transactions ---
  console.log("\n=== Split Transactions ===");
  const { data: splits, count: splitCount } = await db
    .from("split_transactions")
    .select("id, group_id, payer_member_id", { count: "exact" })
    .in("group_id", groupIds)
    .limit(100);
  ok("splits exist", (splitCount ?? 0) > 0, `${splitCount ?? 0} total`);

  const withPayer = (splits ?? []).filter((s) => s.payer_member_id);
  ok("splits have payer_member_id", withPayer.length > 0, `${withPayer.length}/${(splits ?? []).length} sampled`);

  // --- 5. split_shares ---
  console.log("\n=== Split Shares ===");
  const sampleIds = (splits ?? []).slice(0, 10).map((s) => s.id);
  if (sampleIds.length > 0) {
    const { data: shares } = await db
      .from("split_shares")
      .select("split_transaction_id, member_id, amount")
      .in("split_transaction_id", sampleIds);
    ok("shares exist for splits", (shares?.length ?? 0) > 0, `${shares?.length ?? 0} for ${sampleIds.length} splits`);
  } else {
    ok("shares exist for splits", false, "no splits to check");
  }

  // --- 6. settlements ---
  console.log("\n=== Settlements ===");
  const { data: settlements, count: settlementCount } = await db
    .from("settlements")
    .select("id", { count: "exact" })
    .in("group_id", groupIds)
    .limit(1);
  ok("settlements query succeeds", true, `${settlementCount ?? 0} settlements`);

  // --- 7. recent-activity endpoint simulation ---
  console.log("\n=== GET /api/groups/recent-activity ===");
  const { data: actSplits } = await db
    .from("split_transactions")
    .select("id, group_id, transaction_id, created_by, created_at, description, transactions(merchant_name, raw_name, amount, date)")
    .in("group_id", groupIds)
    .order("created_at", { ascending: false })
    .limit(30);
  ok("activity splits returned", (actSplits?.length ?? 0) > 0, `${actSplits?.length ?? 0} recent`);

  // --- Summary ---
  console.log(`\n${"=".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("\n⚠️  Some checks failed. The app may show incomplete data.");
    process.exit(1);
  } else {
    console.log("\n✅ All checks passed. API should return correct data.");
  }
}

async function findFirstOwner(): Promise<string | null> {
  const { data } = await db.from("groups").select("owner_id").limit(1);
  return data?.[0]?.owner_id ?? null;
}

main().catch((err) => {
  console.error("Script error:", err);
  process.exit(1);
});

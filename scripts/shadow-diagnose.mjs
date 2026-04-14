#!/usr/bin/env node
/**
 * Direct diagnostic script for shadow/dual-write mirror groups.
 * Bypasses HTTP auth — connects to Supabase and Splitwise directly.
 *
 * Usage: node scripts/shadow-diagnose.mjs
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SW_BASE = "https://secure.splitwise.com/api/v3.0";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY);

async function swFetch(token, path) {
  const res = await fetch(`${SW_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SW ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function swPost(token, path, body) {
  const res = await fetch(`${SW_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SW POST ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function main() {
  // Find all splitwise_tokens rows with shadow_mirror_map
  const { data: tokenRows, error } = await db
    .from("splitwise_tokens")
    .select("clerk_user_id, access_token, shadow_mirror_map");

  if (error) {
    console.error("Failed to query splitwise_tokens:", error.message);
    process.exit(1);
  }

  const rows = tokenRows.filter((r) => r.access_token);
  console.log(`Found ${rows.length} Splitwise token row(s)\n`);

  for (const row of rows) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`User: ${row.clerk_user_id}`);
    console.log(`Mirror map: ${JSON.stringify(row.shadow_mirror_map)}`);

    const token = row.access_token; // plaintext (no encryption key)

    let swUser;
    try {
      const data = await swFetch(token, "/get_current_user");
      swUser = data.user;
      console.log(`SW user: ${swUser.first_name} ${swUser.last_name} (id=${swUser.id}, email=${swUser.email})`);
    } catch (e) {
      console.error(`  FAILED to get SW user: ${e.message}`);
      continue;
    }

    const mirrorMap = row.shadow_mirror_map ?? {};
    const coconutGroupIds = Object.keys(mirrorMap);

    if (coconutGroupIds.length === 0) {
      console.log("  No mirror groups in map.");

      // Check for orphaned mirrors on Splitwise
      try {
        const { groups } = await swFetch(token, "/get_groups");
        const mirrors = groups.filter((g) => g.name.startsWith("Mirror "));
        if (mirrors.length > 0) {
          console.log(`  BUT found ${mirrors.length} orphaned "Mirror ..." groups on Splitwise:`);
          for (const m of mirrors) {
            console.log(`    - ${m.name} (SW id=${m.id}, ${m.members.length} members)`);
            for (const mem of m.members) {
              console.log(`      member: ${mem.first_name} ${mem.last_name} (id=${mem.id}, email=${mem.email})`);
            }
          }
        }
      } catch (e) {
        console.error(`  Failed to list SW groups: ${e.message}`);
      }
      continue;
    }

    // Load coconut groups
    const { data: groups } = await db
      .from("groups")
      .select("id, name, group_type, external_id, source")
      .in("id", coconutGroupIds);

    for (const cGroup of groups ?? []) {
      const mirrorSwGroupId = mirrorMap[cGroup.id];
      console.log(`\n  --- Group: "${cGroup.name}" (id=${cGroup.id}) ---`);
      console.log(`  Source: ${cGroup.source}, external_id: ${cGroup.external_id}`);
      console.log(`  Mirror SW group ID: ${mirrorSwGroupId}`);

      // Load coconut members
      const { data: members } = await db
        .from("group_members")
        .select("id, email, display_name, user_id")
        .eq("group_id", cGroup.id);

      console.log(`  Coconut members (${(members ?? []).length}):`);
      for (const m of members ?? []) {
        console.log(`    - ${m.display_name} | email=${m.email ?? "NULL"} | user_id=${m.user_id ?? "NULL"} | id=${m.id}`);
      }

      // Check mirror group on Splitwise
      try {
        const { group: mirrorGroup } = await swFetch(token, `/get_group/${mirrorSwGroupId}`);
        console.log(`  Mirror SW group: "${mirrorGroup.name}" (${mirrorGroup.members.length} members)`);
        for (const m of mirrorGroup.members) {
          console.log(`    - ${m.first_name} ${m.last_name} | email=${m.email} | id=${m.id}`);
        }

        // Member mapping
        console.log(`  Member mapping:`);
        let mappedCount = 0;
        for (const cm of members ?? []) {
          // Token owner match
          if (cm.user_id === row.clerk_user_id) {
            const swMe = mirrorGroup.members.find((m) => m.id === swUser.id);
            if (swMe) {
              console.log(`    ✓ ${cm.display_name} → SW ${swMe.first_name} ${swMe.last_name} (id=${swMe.id}) [token_owner]`);
              mappedCount++;
              continue;
            }
          }
          // Email match
          const email = cm.email?.trim().toLowerCase();
          if (email) {
            const swMatch = mirrorGroup.members.find((m) => m.email?.trim().toLowerCase() === email);
            if (swMatch) {
              console.log(`    ✓ ${cm.display_name} → SW ${swMatch.first_name} ${swMatch.last_name} (id=${swMatch.id}) [email]`);
              mappedCount++;
              continue;
            }
          }
          // Name match
          const name = cm.display_name?.trim().toLowerCase();
          if (name && name !== "you") {
            const swMatch = mirrorGroup.members.find((m) => {
              const full = `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim().toLowerCase();
              return full === name || m.first_name?.trim().toLowerCase() === name;
            });
            if (swMatch) {
              console.log(`    ✓ ${cm.display_name} → SW ${swMatch.first_name} ${swMatch.last_name} (id=${swMatch.id}) [name]`);
              mappedCount++;
              continue;
            }
          }
          console.log(`    ✗ ${cm.display_name} (email=${cm.email ?? "NULL"}) → NO MATCH`);
        }
        console.log(`  Mapped: ${mappedCount}/${(members ?? []).length}`);

        // Mirror expenses
        try {
          const { expenses } = await swFetch(token, `/get_expenses?group_id=${mirrorSwGroupId}&limit=50`);
          const active = expenses.filter((e) => !e.deleted_at);
          console.log(`  Mirror expenses: ${active.length} active`);
          for (const e of active.slice(0, 5)) {
            console.log(`    - "${e.description}" $${e.cost} ${e.currency_code} (${e.payment ? "PAYMENT" : "expense"}) ${e.date}`);
          }
        } catch (e) {
          console.error(`  Failed to get mirror expenses: ${e.message}`);
        }

        // Simplified debts
        if (mirrorGroup.simplified_debts?.length > 0) {
          console.log(`  Simplified debts:`);
          for (const d of mirrorGroup.simplified_debts) {
            const from = mirrorGroup.members.find((m) => m.id === d.from);
            const to = mirrorGroup.members.find((m) => m.id === d.to);
            console.log(`    ${from?.first_name ?? d.from} → ${to?.first_name ?? d.to}: ${d.amount} ${d.currency_code ?? "USD"}`);
          }
        } else {
          console.log(`  No simplified debts (empty mirror)`);
        }
      } catch (e) {
        console.error(`  FAILED to fetch mirror group ${mirrorSwGroupId}: ${e.message}`);
      }

      // If SW-imported, also check the real group
      if (cGroup.external_id && cGroup.source === "splitwise") {
        try {
          const { group: realGroup } = await swFetch(token, `/get_group/${cGroup.external_id}`);
          const { expenses } = await swFetch(token, `/get_expenses?group_id=${cGroup.external_id}&limit=10`);
          const active = expenses.filter((e) => !e.deleted_at);
          console.log(`  Real SW group: "${realGroup.name}" (${realGroup.members.length} members, ${active.length}+ expenses)`);
        } catch (e) {
          console.error(`  Failed to fetch real SW group: ${e.message}`);
        }
      }

      // Check coconut split_transactions
      const { data: splits, count } = await db
        .from("split_transactions")
        .select("id, source, external_id", { count: "exact" })
        .eq("group_id", cGroup.id);

      const bySource = {};
      for (const s of splits ?? []) {
        bySource[s.source ?? "null"] = (bySource[s.source ?? "null"] ?? 0) + 1;
      }
      console.log(`  Coconut splits: ${count} total, by source: ${JSON.stringify(bySource)}`);
    }

    // Also check for orphaned mirror groups not in the map
    try {
      const { groups: allSwGroups } = await swFetch(token, "/get_groups");
      const mirrors = allSwGroups.filter((g) => g.name.startsWith("Mirror "));
      const mappedIds = new Set(Object.values(mirrorMap));
      const orphaned = mirrors.filter((g) => !mappedIds.has(g.id));
      if (orphaned.length > 0) {
        console.log(`\n  Orphaned mirror groups on SW (not in map):`);
        for (const g of orphaned) {
          console.log(`    - "${g.name}" (id=${g.id}, ${g.members.length} members)`);
        }
      }
    } catch (e) {
      console.error(`  Failed to scan for orphaned mirrors: ${e.message}`);
    }
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});

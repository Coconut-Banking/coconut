export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import { getEffectiveUserId } from "@/lib/demo";
import { parseP2PCSV } from "@/lib/csv-import/parsers";
import { CACHE_TAGS } from "@/lib/cached-queries";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

/** Escape SQL LIKE metacharacters so user input is treated as literal text. */
function escapeLikePattern(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * POST /api/csv-import
 * Accepts FormData with a CSV file. Parses, deduplicates, auto-links, and imports.
 */
export async function POST(request: NextRequest) {
  // Parallelize auth + form data parsing (independent)
  const [effectiveUserId, formData] = await Promise.all([
    getEffectiveUserId(),
    request.formData(),
  ]);
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const file = formData.get("file") as File | null;
    const forcePlatform = formData.get("platform") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "File too large (max 5MB)" }, { status: 400 });
    }

    // Validate filename extension
    if (!file.name?.toLowerCase().endsWith(".csv")) {
      return NextResponse.json({ error: "Only CSV files are accepted" }, { status: 400 });
    }

    // Validate MIME type (some browsers send empty string for CSV)
    const allowedTypes = ["text/csv", "application/csv", "text/plain", ""];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: "Invalid file type" }, { status: 400 });
    }

    // Read file content
    const text = await file.text();

    // Validate it's actually text/CSV (not binary)
    // Matches C0 control chars (except \t=0x09, \n=0x0A, \r=0x0D which are valid in CSV)
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x08\x0E-\x1F]/.test(text.slice(0, 1000))) {
      return NextResponse.json({ error: "File appears to be binary, not CSV" }, { status: 400 });
    }

    // Parse CSV
    const VALID_PLATFORMS = ["venmo", "cashapp", "paypal"] as const;
    type ValidPlatform = typeof VALID_PLATFORMS[number];
    const platform: ValidPlatform | undefined = (VALID_PLATFORMS as readonly string[]).includes(forcePlatform ?? "")
      ? (forcePlatform as ValidPlatform)
      : undefined;
    const { platform: detectedPlatform, rows, errors: parseErrors } = parseP2PCSV(text, platform);

    if (rows.length > 10000) {
      return NextResponse.json({ error: "Too many transactions (max 10,000 per import)" }, { status: 400 });
    }

    if (rows.length === 0) {
      return NextResponse.json({
        error: "No valid transactions found in CSV",
        parseErrors,
        platform: detectedPlatform,
      }, { status: 400 });
    }

    // Upsert into transactions table with dedup against Plaid data
    const db = getSupabase();
    let imported = 0;
    let skipped = 0;
    let enriched = 0;

    // Phase 1: Run all Plaid match queries in parallel
    const plaidMatchResults = await Promise.all(
      rows.map((row) => {
        const absAmount = Math.abs(row.amount);
        const dateObj = new Date(row.date);
        const dayBefore = new Date(dateObj);
        dayBefore.setDate(dayBefore.getDate() - 1);
        const dayAfter = new Date(dateObj);
        dayAfter.setDate(dayAfter.getDate() + 1);
        return db
          .from("transactions")
          .select("id, amount, date")
          .eq("clerk_user_id", effectiveUserId)
          .eq("source", "plaid")
          .gte("date", dayBefore.toISOString().split("T")[0])
          .lte("date", dayAfter.toISOString().split("T")[0])
          .ilike("merchant_name", `%${escapeLikePattern(row.platform)}%`)
          .then((r) =>
            (r.data ?? []).filter(
              (m) => Math.abs(Math.abs(Number(m.amount)) - absAmount) < 0.02
            )
          );
      })
    );

    // Phase 2: Classify rows
    const enrichUpdates: Array<{ id: string; row: typeof rows[number] }> = [];
    const upsertRows: Array<{
      clerk_user_id: string;
      source: string;
      external_id: string;
      date: string;
      amount: number;
      merchant_name: string;
      raw_name: string;
      p2p_counterparty: string;
      p2p_note: string | null;
      p2p_platform: string;
      primary_category: string;
    }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const exactMatch = plaidMatchResults[i];
      if (exactMatch.length === 1) {
        enrichUpdates.push({ id: exactMatch[0].id, row });
      } else {
        upsertRows.push({
          clerk_user_id: effectiveUserId,
          source: row.platform === "cashapp" ? "csv_import" : row.platform,
          external_id: row.externalId,
          date: row.date,
          amount: row.amount,
          merchant_name: row.counterpartyName,
          raw_name: row.counterpartyName,
          p2p_counterparty: row.counterpartyName,
          p2p_note: row.note || null,
          p2p_platform: row.platform,
          primary_category: row.amount > 0 ? "TRANSFER_IN" : "TRANSFER_OUT",
        });
      }
    }

    // Phase 3: Execute updates + upserts in parallel
    const BATCH = 500;
    const [updateResults, upsertResults] = await Promise.all([
      Promise.all(
        enrichUpdates.map(({ id, row: r }) =>
          db
            .from("transactions")
            .update({ p2p_counterparty: r.counterpartyName, p2p_note: r.note || null, p2p_platform: r.platform })
            .eq("id", id)
            .then((res) => !res.error)
        )
      ),
      Promise.all(
        Array.from({ length: Math.ceil(upsertRows.length / BATCH) || 1 }, (_, i) =>
          upsertRows.length > 0
            ? db
                .from("transactions")
                .upsert(upsertRows.slice(i * BATCH, (i + 1) * BATCH), { onConflict: "clerk_user_id,source,external_id" })
                .then((res) => ({ error: res.error, count: upsertRows.slice(i * BATCH, (i + 1) * BATCH).length }))
            : Promise.resolve({ error: null, count: 0 })
        )
      ),
    ]);

    enriched = updateResults.filter(Boolean).length;
    const upsertedCount = upsertResults.reduce((sum, r) => sum + (r.error ? 0 : r.count), 0);
    skipped = upsertResults.reduce((sum, r) => sum + (r.error ? r.count : 0), 0);
    imported = enriched + upsertedCount;

    if (imported > 0) {
      revalidateTag(CACHE_TAGS.transactions(effectiveUserId), "max");
    }

    return NextResponse.json({
      platform: detectedPlatform,
      total: rows.length,
      imported,
      skipped,
      enriched,
      parseErrors,
    });
  } catch (err) {
    console.error("[csv-import] Error:", err);
    return NextResponse.json(
      { error: "Import failed" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import { getEffectiveUserId } from "@/lib/demo";
import { parseP2PCSV } from "@/lib/csv-import/parsers";
import { CACHE_TAGS } from "@/lib/cached-queries";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * POST /api/csv-import
 * Accepts FormData with a CSV file. Parses, deduplicates, auto-links, and imports.
 */
export async function POST(request: NextRequest) {
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
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
    if (/[\x00-\x08\x0E-\x1F]/.test(text.slice(0, 1000))) {
      return NextResponse.json({ error: "File appears to be binary, not CSV" }, { status: 400 });
    }

    // Parse CSV
    const platform = forcePlatform as "venmo" | "cashapp" | "paypal" | undefined;
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

    for (const row of rows) {
      const absAmount = Math.abs(row.amount);

      // Check for matching Plaid transaction to enrich
      const dateObj = new Date(row.date);
      const dayBefore = new Date(dateObj);
      dayBefore.setDate(dayBefore.getDate() - 1);
      const dayAfter = new Date(dateObj);
      dayAfter.setDate(dayAfter.getDate() + 1);

      const { data: matches } = await db
        .from("transactions")
        .select("id, amount, date")
        .eq("clerk_user_id", effectiveUserId)
        .eq("source", "plaid")
        .gte("date", dayBefore.toISOString().split("T")[0])
        .lte("date", dayAfter.toISOString().split("T")[0])
        .ilike("merchant_name", `%${row.platform}%`);

      const exactMatch = (matches ?? []).filter(
        (m) => Math.abs(Math.abs(Number(m.amount)) - absAmount) < 0.02
      );

      if (exactMatch.length === 1) {
        // Enrich existing Plaid transaction
        await db.from("transactions").update({
          p2p_counterparty: row.counterpartyName,
          p2p_note: row.note || null,
          p2p_platform: row.platform,
        }).eq("id", exactMatch[0].id);
        enriched++;
        imported++;
      } else {
        // Insert as new P2P transaction
        const { error } = await db.from("transactions").upsert(
          {
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
          },
          { onConflict: "clerk_user_id,source,external_id" }
        );

        if (error) {
          skipped++;
        } else {
          imported++;
        }
      }
    }

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
      { error: err instanceof Error ? err.message : "Import failed" },
      { status: 500 }
    );
  }
}

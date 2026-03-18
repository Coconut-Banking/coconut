import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import { getEffectiveUserId } from "@/lib/demo";
import { parseP2PCSV } from "@/lib/csv-import/parsers";
import { autoLinkTransactions } from "@/lib/csv-import/auto-link";
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

    // Read file content
    const text = await file.text();

    // Validate it's actually text/CSV (not binary)
    if (/[\x00-\x08\x0E-\x1F]/.test(text.slice(0, 1000))) {
      return NextResponse.json({ error: "File appears to be binary, not CSV" }, { status: 400 });
    }

    // Parse CSV
    const platform = forcePlatform as "venmo" | "cashapp" | "paypal" | undefined;
    const { platform: detectedPlatform, rows, errors: parseErrors } = parseP2PCSV(text, platform);

    if (rows.length === 0) {
      return NextResponse.json({
        error: "No valid transactions found in CSV",
        parseErrors,
        platform: detectedPlatform,
      }, { status: 400 });
    }

    // Auto-link with bank transactions
    const linkResults = await autoLinkTransactions(effectiveUserId, rows);

    // Build a map from externalId to link info
    const linkMap = new Map(linkResults.map((r) => [r.p2pExternalId, r]));

    // Upsert into p2p_transactions
    const db = getSupabase();
    let imported = 0;
    let skipped = 0;
    let linked = 0;

    for (const row of rows) {
      const linkInfo = linkMap.get(row.externalId);

      const { error } = await db.from("p2p_transactions").upsert(
        {
          clerk_user_id: effectiveUserId,
          platform: row.platform,
          external_id: row.externalId,
          date: row.date,
          amount: row.amount,
          counterparty_name: row.counterpartyName,
          note: row.note || null,
          status: row.status,
          linked_transaction_id: linkInfo?.linkedTransactionId ?? null,
          link_confidence: linkInfo?.confidence ?? null,
        },
        { onConflict: "clerk_user_id,platform,external_id" }
      );

      if (error) {
        skipped++;
      } else {
        imported++;
        if (linkInfo?.linkedTransactionId) linked++;
      }
    }

    // Build suggestions for user review (medium-confidence links)
    const suggestions = linkResults
      .filter((r) => !r.linkedTransactionId && r.candidates.length > 0)
      .map((r) => ({
        externalId: r.p2pExternalId,
        candidates: r.candidates,
      }));

    if (imported > 0) {
      revalidateTag(CACHE_TAGS.transactions(effectiveUserId), "max");
    }

    return NextResponse.json({
      platform: detectedPlatform,
      total: rows.length,
      imported,
      skipped,
      linked,
      suggestionsCount: suggestions.length,
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

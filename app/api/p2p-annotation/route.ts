export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getEffectiveUserId } from "@/lib/demo";

/**
 * GET /api/p2p-annotation?ids=uuid1,uuid2,...
 * Batch-fetch annotations for a set of transaction IDs.
 */
export async function GET(request: NextRequest) {
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const idsParam = request.nextUrl.searchParams.get("ids");
  if (!idsParam) {
    return NextResponse.json({ annotations: [] });
  }

  const ids = idsParam.split(",").filter(Boolean).slice(0, 200);
  if (ids.length === 0) {
    return NextResponse.json({ annotations: [] });
  }

  try {
    const db = getSupabase();
    const { data, error } = await db
      .from("p2p_annotations")
      .select("id, transaction_id, counterparty_name, note, platform, created_at")
      .eq("clerk_user_id", effectiveUserId)
      .in("transaction_id", ids);

    if (error) throw error;
    return NextResponse.json({ annotations: data ?? [] });
  } catch (err) {
    console.error("[p2p-annotation] GET error:", err);
    return NextResponse.json({ error: "Failed to fetch annotations" }, { status: 500 });
  }
}

/**
 * POST /api/p2p-annotation
 * Create or update an annotation for a transaction.
 * Body: { transactionId, counterpartyName, note?, platform? }
 */
export async function POST(request: NextRequest) {
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { transactionId, counterpartyName, note, platform } = body as {
      transactionId: string;
      counterpartyName: string;
      note?: string;
      platform?: string;
    };

    if (!transactionId || !counterpartyName?.trim()) {
      return NextResponse.json({ error: "transactionId and counterpartyName are required" }, { status: 400 });
    }

    const db = getSupabase();

    // Verify the transaction belongs to the authenticated user
    const { data: txCheck, error: txCheckError } = await db
      .from("transactions")
      .select("id")
      .eq("id", transactionId)
      .eq("clerk_user_id", effectiveUserId)
      .maybeSingle();

    if (txCheckError || !txCheck) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }
    const { data, error } = await db
      .from("p2p_annotations")
      .upsert(
        {
          clerk_user_id: effectiveUserId,
          transaction_id: transactionId,
          counterparty_name: counterpartyName.trim(),
          note: note?.trim() || null,
          platform: platform || null,
        },
        { onConflict: "transaction_id" }
      )
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ annotation: data });
  } catch (err) {
    console.error("[p2p-annotation] POST error:", err);
    return NextResponse.json({ error: "Failed to save annotation" }, { status: 500 });
  }
}

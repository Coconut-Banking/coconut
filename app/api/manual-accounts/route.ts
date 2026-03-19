export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getEffectiveUserId } from "@/lib/demo";

/**
 * GET /api/manual-accounts
 * List all manual wallet accounts for the current user.
 */
export async function GET() {
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getSupabase();
    const { data, error } = await db
      .from("manual_accounts")
      .select("id, name, platform, balance, iso_currency_code, updated_at, created_at")
      .eq("clerk_user_id", effectiveUserId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return NextResponse.json({ accounts: data ?? [] });
  } catch (err) {
    console.error("[manual-accounts] GET error:", err);
    return NextResponse.json({ error: "Failed to fetch accounts" }, { status: 500 });
  }
}

/**
 * POST /api/manual-accounts
 * Create or update a manual wallet account.
 * Body: { name, platform, balance, iso_currency_code? }
 */
export async function POST(request: NextRequest) {
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { name, platform, balance, iso_currency_code } = body as {
      name: string;
      platform: string;
      balance: number;
      iso_currency_code?: string;
    };

    if (!name?.trim() || !platform?.trim()) {
      return NextResponse.json({ error: "name and platform are required" }, { status: 400 });
    }

    if (typeof balance !== "number" || !isFinite(balance)) {
      return NextResponse.json({ error: "balance must be a valid number" }, { status: 400 });
    }

    const db = getSupabase();
    const { data, error } = await db
      .from("manual_accounts")
      .upsert(
        {
          clerk_user_id: effectiveUserId,
          name: name.trim(),
          platform: platform.trim().toLowerCase(),
          balance,
          iso_currency_code: iso_currency_code || "USD",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "clerk_user_id,platform,name" }
      )
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ account: data });
  } catch (err) {
    console.error("[manual-accounts] POST error:", err);
    return NextResponse.json({ error: "Failed to save account" }, { status: 500 });
  }
}

/**
 * DELETE /api/manual-accounts?id=uuid
 * Delete a manual wallet account.
 */
export async function DELETE(request: NextRequest) {
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    const db = getSupabase();
    const { error } = await db
      .from("manual_accounts")
      .delete()
      .eq("id", id)
      .eq("clerk_user_id", effectiveUserId);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[manual-accounts] DELETE error:", err);
    return NextResponse.json({ error: "Failed to delete account" }, { status: 500 });
  }
}

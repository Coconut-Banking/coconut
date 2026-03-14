import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getEffectiveUserId } from "@/lib/demo";

export async function GET() {
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getSupabase();
    const { data: items, error } = await db
      .from("plaid_items")
      .select("access_token, needs_reauth, new_accounts_available")
      .eq("clerk_user_id", effectiveUserId);
    if (error) {
      const { data: fallback } = await db
        .from("plaid_items")
        .select("access_token")
        .eq("clerk_user_id", effectiveUserId);
      const linked = fallback && fallback.length > 0;
      return NextResponse.json({ linked: Boolean(linked), needs_reauth: false, new_accounts_available: false });
    }
    const linked = items && items.length > 0 && items.some((r) => r.access_token);
    const needsReauth = items?.some((r) => r.needs_reauth === true) ?? false;
    const newAccountsAvailable = items?.some((r) => r.new_accounts_available === true) ?? false;
    return NextResponse.json({ linked: Boolean(linked), needs_reauth: needsReauth, new_accounts_available: newAccountsAvailable });
  } catch {
    return NextResponse.json({ linked: false, needs_reauth: false, new_accounts_available: false });
  }
}

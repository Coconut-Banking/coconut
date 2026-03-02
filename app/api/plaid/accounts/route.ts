import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { getPlaidClient } from "@/lib/plaid-client";
import { getPlaidTokenForUser } from "@/lib/transaction-sync";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // Serve from Supabase cache first
    const db = getSupabase();
    const { data: cached } = await db
      .from("accounts")
      .select("*")
      .eq("clerk_user_id", userId);

    if (cached && cached.length > 0) {
      // Shape to match what the settings page expects (Plaid-like structure)
      return NextResponse.json({
        accounts: cached.map((a) => ({
          account_id: a.plaid_account_id,
          name: a.name,
          type: a.type,
          subtype: a.subtype,
          mask: a.mask,
        })),
      });
    }

    // Fallback: fetch live from Plaid
    const accessToken = await getPlaidTokenForUser(userId);
    if (!accessToken) return NextResponse.json({ error: "Not linked" }, { status: 401 });

    const client = getPlaidClient();
    if (!client) return NextResponse.json({ error: "Plaid not configured" }, { status: 503 });

    const response = await client.accountsGet({ access_token: accessToken });
    return NextResponse.json(response.data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get accounts";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

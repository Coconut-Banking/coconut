import { NextResponse } from "next/server";
import { getPlaidClient } from "@/lib/plaid-client";
import { getPlaidAccessToken } from "@/lib/plaid-client";
import { plaidTransactionToUI } from "@/lib/plaid-mappers";

export async function GET() {
  const accessToken = getPlaidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: "Not linked" }, { status: 401 });
  }

  const client = getPlaidClient();
  if (!client) {
    return NextResponse.json({ error: "Plaid not configured" }, { status: 503 });
  }

  try {
    const allAdded: Array<Parameters<typeof plaidTransactionToUI>[0]> = [];
    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const response = await client.transactionsSync({
        access_token: accessToken,
        cursor,
        count: 500,
      });
      const data = response.data;
      allAdded.push(...data.added);
      cursor = data.next_cursor;
      hasMore = data.has_more;
    }

    const mapped = allAdded
      .map(plaidTransactionToUI)
      .sort((a, b) => b.date.localeCompare(a.date));

    return NextResponse.json(mapped);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to get transactions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getGmailClient } from "@/lib/google-auth";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const gmail = await getGmailClient(userId);
    if (!gmail) throw new Error("Gmail not connected");

    // Search specifically for Amazon emails
    const amazonQueries = [
      'from:amazon.com',
      'from:auto-confirm@amazon.com',
      'from:ship-confirm@amazon.com',
      'from:digital-no-reply@amazon.com',
      'from:order-update@amazon.com',
      'subject:"Your Amazon.com order"',
      'subject:"Your order of"',
      '"Order Confirmation" from:amazon',
    ];

    const results: any[] = [];

    for (const query of amazonQueries) {
      console.log(`[Debug Amazon] Searching with query: ${query}`);
      try {
        const listResp = await gmail.users.messages.list({
          userId: "me",
          q: query,
          maxResults: 5,
        });

        if (listResp.data.messages && listResp.data.messages.length > 0) {
          // Get details of first message for debugging
          const msgId = listResp.data.messages[0].id!;
          const msg = await gmail.users.messages.get({
            userId: "me",
            id: msgId,
            format: "metadata",
            metadataHeaders: ["From", "Subject", "Date"]
          });

          results.push({
            query,
            count: listResp.data.messages.length,
            sample: {
              from: msg.data.payload?.headers?.find(h => h.name === "From")?.value,
              subject: msg.data.payload?.headers?.find(h => h.name === "Subject")?.value,
              date: msg.data.payload?.headers?.find(h => h.name === "Date")?.value,
            }
          });
        } else {
          results.push({
            query,
            count: 0,
            sample: null
          });
        }
      } catch (e) {
        console.error(`[Debug Amazon] Error with query ${query}:`, e);
        results.push({
          query,
          error: e instanceof Error ? e.message : "Unknown error"
        });
      }
    }

    return NextResponse.json({
      message: "Amazon email search debug results",
      results,
      summary: {
        totalQueries: amazonQueries.length,
        queriesWithResults: results.filter(r => r.count > 0).length,
        totalEmailsFound: results.reduce((sum, r) => sum + (r.count || 0), 0)
      }
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Debug failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
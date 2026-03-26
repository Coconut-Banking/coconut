export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { scanGmailForReceipts } from "@/lib/receipt-parser";
import { GMAIL } from "@/lib/config";
import { rateLimit } from "@/lib/rate-limit";
import { getEffectiveUserId } from "@/lib/demo";

export async function POST(request: Request) {
  const userId = await getEffectiveUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = rateLimit(`gmail-scan:${userId}`, 20, 60_000);
  if (!rl.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  try {
    // Parse request body for options
    const body = await request.json().catch(() => ({}));
    const daysBack = body.daysBack || GMAIL.DEFAULT_SCAN_DAYS;
    const detailed = body.detailed !== false; // Default to true for detailed parsing
    const forceRescan = body.forceRescan === true; // Default to false

    if (forceRescan) {
      console.log("[Gmail Scan] Force rescan requested - will reprocess all emails");
    }

    const result = await scanGmailForReceipts(userId, daysBack, detailed, forceRescan);

    // If there's an error in the result (like missing OpenAI key), pass it through
    if (result.error) {
      console.log("[Gmail Scan] Error:", result.error);
    }

    return NextResponse.json(result);
  } catch (e) {
    const rawMessage = e instanceof Error ? e.message : "Scan failed";
    console.error("[gmail-scan]", rawMessage);
    // Detect auth/token errors so the UI can prompt reconnection
    const isAuthError = rawMessage.includes("invalid_grant") || rawMessage.includes("Token has been") || rawMessage.includes("401");
    const status = isAuthError ? 403 : 500;
    const userMessage = isAuthError
      ? "Gmail connection expired. Please reconnect in Settings."
      : "Gmail scan failed. Please try again.";
    return NextResponse.json({ error: userMessage, authError: isAuthError }, { status });
  }
}

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { scanGmailForReceipts } from "@/lib/receipt-parser";

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // Parse request body for options
    const body = await request.json().catch(() => ({}));
    const daysBack = body.daysBack || 7; // Default to 7 days
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
    const message = e instanceof Error ? e.message : "Scan failed";
    // Detect auth/token errors so the UI can prompt reconnection
    const isAuthError = message.includes("invalid_grant") || message.includes("Token has been") || message.includes("401");
    const status = isAuthError ? 403 : 500;
    return NextResponse.json({ error: message, authError: isAuthError }, { status });
  }
}

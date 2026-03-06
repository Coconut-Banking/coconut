import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { scanGmailForReceipts } from "@/lib/receipt-parser";

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const result = await scanGmailForReceipts(userId);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Scan failed";
    // Detect auth/token errors so the UI can prompt reconnection
    const isAuthError = message.includes("invalid_grant") || message.includes("Token has been") || message.includes("401");
    const status = isAuthError ? 403 : 500;
    return NextResponse.json({ error: message, authError: isAuthError }, { status });
  }
}

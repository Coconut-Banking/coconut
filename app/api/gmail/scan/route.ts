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
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getPlaidTokenForUser } from "@/lib/transaction-sync";
import { getEffectiveUserId } from "@/lib/demo";

export async function GET() {
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const token = await getPlaidTokenForUser(effectiveUserId);
    return NextResponse.json({ linked: Boolean(token) });
  } catch {
    return NextResponse.json({ linked: false });
  }
}

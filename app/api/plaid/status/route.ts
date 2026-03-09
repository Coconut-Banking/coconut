import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getPlaidTokenForUser } from "@/lib/transaction-sync";

const DEMO_USER_ID = "demo-sandbox-user";

export async function GET() {
  const { userId } = await auth();
  // Fall back to demo user when no auth (e.g. testing from app with demo Plaid link)
  const effectiveUserId = userId ?? DEMO_USER_ID;

  try {
    let token = await getPlaidTokenForUser(effectiveUserId);
    if (!token && userId) {
      token = await getPlaidTokenForUser(DEMO_USER_ID);
    }
    return NextResponse.json({ linked: Boolean(token) });
  } catch {
    return NextResponse.json({ linked: false });
  }
}

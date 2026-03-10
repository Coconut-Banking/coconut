import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getPlaidTokenForUser } from "@/lib/transaction-sync";

const DEMO_USER_ID = "demo-sandbox-user";

export async function GET() {
  const { userId } = await auth();
  // Production: require real auth, never use demo/sandbox user
  const effectiveUserId =
    userId ?? (process.env.NODE_ENV === "production" ? null : DEMO_USER_ID);
  if (!effectiveUserId) {
    return NextResponse.json({ linked: false });
  }

  try {
    const token = await getPlaidTokenForUser(effectiveUserId);
    return NextResponse.json({ linked: Boolean(token) });
  } catch {
    return NextResponse.json({ linked: false });
  }
}

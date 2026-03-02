import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getPlaidTokenForUser } from "@/lib/transaction-sync";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ linked: false });

  try {
    const token = await getPlaidTokenForUser(userId);
    return NextResponse.json({ linked: Boolean(token) });
  } catch {
    return NextResponse.json({ linked: false });
  }
}

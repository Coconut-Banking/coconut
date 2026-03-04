import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getGmailStatus } from "@/lib/google-auth";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const status = await getGmailStatus(userId);
  return NextResponse.json(status);
}

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { removeGmailConnection } from "@/lib/google-auth";

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await removeGmailConnection(userId);
  return NextResponse.json({ ok: true });
}

export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { removeGmailConnection } from "@/lib/google-auth";
import { getEffectiveUserId } from "@/lib/demo";

export async function POST() {
  const userId = await getEffectiveUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await removeGmailConnection(userId);
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { getEffectiveUserId } from "@/lib/demo";
import { getAuthUrl } from "@/lib/paypal-auth";

export async function GET() {
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const authUrl = getAuthUrl(effectiveUserId);
    return NextResponse.json({ authUrl });
  } catch (err) {
    console.error("[paypal/auth] Error:", err);
    return NextResponse.json(
      { error: "Failed to generate auth URL" },
      { status: 500 }
    );
  }
}

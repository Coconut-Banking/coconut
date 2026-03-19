import { NextResponse } from "next/server";
import { getEffectiveUserId } from "@/lib/demo";
import { removePayPalConnection } from "@/lib/paypal-auth";

export async function POST() {
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await removePayPalConnection(effectiveUserId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[paypal/disconnect] Error:", err);
    return NextResponse.json(
      { error: "Failed to disconnect" },
      { status: 500 }
    );
  }
}

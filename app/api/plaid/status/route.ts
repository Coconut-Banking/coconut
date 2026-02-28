import { NextResponse } from "next/server";
import { getPlaidAccessToken } from "@/lib/plaid-client";

export async function GET() {
  const linked = Boolean(getPlaidAccessToken());
  return NextResponse.json({ linked });
}

import { NextResponse } from "next/server";
import { getSubscriptions } from "@/lib/data";

export async function GET() {
  const subscriptions = getSubscriptions();
  return NextResponse.json(subscriptions);
}

import { NextResponse } from "next/server";
import { getTransactions } from "@/lib/data";

export async function GET() {
  const transactions = getTransactions();
  return NextResponse.json(transactions);
}

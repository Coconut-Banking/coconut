export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { canAccessGroup } from "@/lib/group-access";
import { normalizeSplitCurrency } from "@/lib/split-balances-currency";
import {
  merchantLabelFromSplitRow,
  paidAmountFromSplitRow,
  splitTransactionDedupeKey,
} from "@/lib/split-transaction-helpers";

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function memberShareColumnHeaders(
  members: { id: string; display_name: string | null }[]
): string[] {
  const counts = new Map<string, number>();
  return members.map((m) => {
    const base = (m.display_name?.trim() || "Member").slice(0, 80);
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    const label = n > 1 ? `${base} (${n})` : base;
    return `${label} share`;
  });
}

function rowDate(
  s: { created_at?: string | null; transactions?: unknown }
): string {
  const tx = s.transactions as
    | { date?: string | null }
    | { date?: string | null }[]
    | null
    | undefined;
  const row = Array.isArray(tx) ? tx[0] : tx;
  const d = row?.date;
  if (d != null && String(d).trim() !== "") return String(d).slice(0, 10);
  const ca = s.created_at;
  if (ca) return String(ca).slice(0, 10);
  return "";
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: groupId } = await params;

  const canAccess = await canAccessGroup(userId, groupId);
  if (!canAccess) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const db = getSupabase();

  const [
    { data: group, error: groupErr },
    { data: membersRaw, error: memErr },
    { data: splitsRaw, error: splitErr },
  ] = await Promise.all([
    db.from("groups").select("name").eq("id", groupId).single(),
    db
      .from("group_members")
      .select("id, display_name, user_id")
      .eq("group_id", groupId)
      .order("display_name", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true }),
    db
      .from("split_transactions")
      .select(
        `
      id, transaction_id, created_at, payer_member_id, amount, description,
      iso_currency_code,
      transactions(merchant_name, raw_name, amount, date)
    `
      )
      .eq("group_id", groupId)
      .order("created_at", { ascending: true }),
  ]);

  if (groupErr || !group) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (memErr) {
    console.error("[groups/export] members:", memErr.message);
    return NextResponse.json({ error: "Failed to load group" }, { status: 500 });
  }
  if (splitErr) {
    console.error("[groups/export] splits:", splitErr.message);
    return NextResponse.json({ error: "Failed to load expenses" }, { status: 500 });
  }

  const members = membersRaw ?? [];
  const memberMap = new Map(members.map((m) => [m.id, m]));
  const memberByUserId = new Map(
    members.filter((m) => m.user_id).map((m) => [m.user_id as string, m.id])
  );

  const seenTxIds = new Set<string>();
  const splits = (splitsRaw ?? []).filter((s) => {
    const k = splitTransactionDedupeKey(s as { id: string; transaction_id?: string | null });
    if (seenTxIds.has(k)) return false;
    seenTxIds.add(k);
    return true;
  });

  const txIds = splits.map((s) => s.transaction_id).filter(Boolean) as string[];
  const splitIds = splits.map((s) => s.id);

  const [{ data: txData }, { data: sh, error: shErr }] = await Promise.all([
    txIds.length > 0
      ? db.from("transactions").select("id, clerk_user_id").in("id", txIds)
      : Promise.resolve({ data: [] as { id: string; clerk_user_id: string }[], error: null }),
    splitIds.length > 0
      ? db.from("split_shares").select("split_transaction_id, member_id, amount").in("split_transaction_id", splitIds)
      : Promise.resolve({ data: [] as { split_transaction_id: string; member_id: string; amount: number | string }[], error: null }),
  ]);

  if (shErr) {
    console.error("[groups/export] shares:", shErr.message);
    return NextResponse.json({ error: "Failed to load shares" }, { status: 500 });
  }
  const txRows = txData ?? [];
  const shares = sh ?? [];
  const txOwnerById = new Map(txRows.map((t) => [t.id, t.clerk_user_id]));

  const sharesBySplit = new Map<string, Map<string, number>>();
  for (const sh of shares) {
    const sid = sh.split_transaction_id;
    if (!sharesBySplit.has(sid)) sharesBySplit.set(sid, new Map());
    const m = sharesBySplit.get(sid)!;
    const mid = sh.member_id;
    m.set(mid, (m.get(mid) ?? 0) + Number(sh.amount));
  }

  const shareHeaders = memberShareColumnHeaders(members);
  const headerRow = [
    "Date",
    "Description",
    "Amount",
    "Currency",
    "Paid By",
    ...shareHeaders,
  ].join(",");

  const dataRows: string[] = [];
  for (const s of splits) {
    const tid = s.transaction_id as string | null | undefined;
    const payerMemberId = (s as { payer_member_id?: string | null }).payer_member_id;
    const resolvedPayerId =
      payerMemberId && memberMap.has(payerMemberId)
        ? payerMemberId
        : (() => {
            const ownerId = tid ? txOwnerById.get(tid) : undefined;
            return ownerId ? memberByUserId.get(ownerId) : undefined;
          })();
    const paidByMember = resolvedPayerId ? memberMap.get(resolvedPayerId) : undefined;
    const paidByLabel = paidByMember?.display_name?.trim() || "Unknown";

    const amount = paidAmountFromSplitRow(
      s as { transactions?: unknown; amount?: number | string | null }
    );
    const currency = normalizeSplitCurrency((s as { iso_currency_code?: string | null }).iso_currency_code);
    const description = merchantLabelFromSplitRow(
      s as { transactions?: unknown; description?: string | null }
    );

    const perMember = sharesBySplit.get(s.id) ?? new Map();
    const shareCells = members.map((m) => {
      const v = perMember.get(m.id);
      return v != null && Number.isFinite(v) ? String(Math.round(v * 100) / 100) : "0";
    });

    const cells = [
      csvEscape(rowDate(s)),
      csvEscape(description),
      String(Math.round(amount * 100) / 100),
      csvEscape(currency),
      csvEscape(paidByLabel),
      ...shareCells,
    ];
    dataRows.push(cells.join(","));
  }

  const csv = [headerRow, ...dataRows].join("\r\n");

  const safeName = String(group.name ?? "group")
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .slice(0, 60) || "group";
  const filename = `${safeName}-expenses.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUserId } from "@/lib/demo";
import { loadClerkAuth } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { payUrlForStoredToken } from "@/lib/payment-requests";

type Tab = "to_pay" | "waiting_on" | "paid" | "collecting";

export async function GET(req: NextRequest) {
  const auth = await loadClerkAuth();
  if (!auth.ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const userId = await getEffectiveUserId({ userId: auth.userId });
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tab = (req.nextUrl.searchParams.get("tab") ?? "to_pay") as Tab;
  const groupId = req.nextUrl.searchParams.get("groupId");

  const db = getSupabase();
  const { data: myMembers } = await db
    .from("group_members")
    .select("id, group_id, display_name")
    .eq("user_id", userId);

  const memberIds = (myMembers ?? []).map((m) => m.id);
  if (memberIds.length === 0 && tab !== "collecting") {
    return NextResponse.json({ bills: [], counts: { to_pay: 0, waiting_on: 0 } });
  }

  if (tab === "collecting") {
    const { data: scans, error: scanErr } = await db
      .from("receipt_scans")
      .select("id, group_id, merchant_name, total, status, collect_session_id, created_at")
      .eq("clerk_user_id", userId)
      .eq("status", "collecting")
      .order("created_at", { ascending: false })
      .limit(20);

    if (scanErr) {
      console.error("[bills] collecting:", scanErr);
      return NextResponse.json({ error: "Failed to load bills" }, { status: 500 });
    }

    const sessionIds = (scans ?? [])
      .map((s) => s.collect_session_id)
      .filter((id): id is string => Boolean(id));

    const guestStats = new Map<string, { total: number; submitted: number }>();
    if (sessionIds.length > 0) {
      const { data: parts } = await db
        .from("receipt_collect_participants")
        .select("collect_session_id, status, member_id")
        .in("collect_session_id", sessionIds);

      const groupIds = [...new Set((scans ?? []).map((s) => s.group_id).filter(Boolean))] as string[];
      const hostMemberByGroup = new Map<string, string>();
      if (groupIds.length > 0) {
        const { data: hostMembers } = await db
          .from("group_members")
          .select("id, group_id")
          .in("group_id", groupIds)
          .eq("user_id", userId);
        for (const hm of hostMembers ?? []) {
          hostMemberByGroup.set(hm.group_id, hm.id);
        }
      }

      for (const sid of sessionIds) {
        guestStats.set(sid, { total: 0, submitted: 0 });
      }
      for (const scan of scans ?? []) {
        if (!scan.collect_session_id || !scan.group_id) continue;
        const hostId = hostMemberByGroup.get(scan.group_id);
        for (const p of parts ?? []) {
          if (p.collect_session_id !== scan.collect_session_id) continue;
          if (hostId && p.member_id === hostId) continue;
          const st = guestStats.get(scan.collect_session_id)!;
          st.total += 1;
          if (p.status === "submitted") st.submitted += 1;
        }
      }
    }

    const groupIds = [...new Set((scans ?? []).map((s) => s.group_id).filter(Boolean))] as string[];
    const { data: groups } = groupIds.length
      ? await db.from("groups").select("id, name").in("id", groupIds)
      : { data: [] as { id: string; name: string }[] };
    const groupName = new Map((groups ?? []).map((g) => [g.id, g.name]));

    const bills = (scans ?? []).map((scan) => {
      const stats = scan.collect_session_id
        ? guestStats.get(scan.collect_session_id) ?? { total: 0, submitted: 0 }
        : { total: 0, submitted: 0 };
      return {
        id: `collect-${scan.id}`,
        receiptId: scan.id,
        groupId: scan.group_id ?? "",
        groupName: groupName.get(scan.group_id ?? "") ?? scan.merchant_name ?? "Bill",
        label: scan.merchant_name ?? "Receipt",
        amount: Number(scan.total) || 0,
        currency: "USD",
        status: "collecting",
        payerMemberId: "",
        receiverMemberId: "",
        payerName: "",
        receiverName: "You",
        payUrl: null,
        createdAt: scan.created_at,
        paidAt: null,
        lastNudgedAt: null,
        isPayer: false,
        isReceiver: true,
        collectGuestCount: stats.total,
        collectGuestsSubmitted: stats.submitted,
      };
    });

    return NextResponse.json({
      bills,
      counts: { to_pay: 0, waiting_on: 0 },
    });
  }

  let q = db
    .from("payment_requests")
    .select(
      "id, group_id, receipt_scan_id, payer_member_id, receiver_member_id, amount, currency, label, status, resolution_method, pay_link_token, created_at, paid_at, last_nudged_at",
    );

  if (tab === "to_pay") {
    q = q.in("payer_member_id", memberIds).eq("status", "pending");
  } else if (tab === "waiting_on") {
    q = q.in("receiver_member_id", memberIds).eq("status", "pending");
  }

  if (groupId && tab !== "paid") q = q.eq("group_id", groupId);

  let rows: Awaited<ReturnType<typeof q.limit>>["data"] = [];
  let error: { message: string } | null = null;

  if (tab === "paid") {
    const selectCols =
      "id, group_id, receipt_scan_id, payer_member_id, receiver_member_id, amount, currency, label, status, resolution_method, pay_link_token, created_at, paid_at, last_nudged_at";
    const basePaid = () => {
      let qb = db
        .from("payment_requests")
        .select(selectCols)
        .in("status", ["paid", "settled_off_link"])
        .order("paid_at", { ascending: false })
        .limit(30);
      if (groupId) qb = qb.eq("group_id", groupId);
      return qb;
    };
    const [asPayer, asReceiver] = await Promise.all([
      basePaid().in("payer_member_id", memberIds),
      basePaid().in("receiver_member_id", memberIds),
    ]);
    error = asPayer.error ?? asReceiver.error;
    const byId = new Map<string, NonNullable<typeof asPayer.data>[number]>();
    for (const r of [...(asPayer.data ?? []), ...(asReceiver.data ?? [])]) {
      byId.set(r.id, r);
    }
    rows = [...byId.values()].sort(
      (a, b) => new Date(b.paid_at ?? b.created_at).getTime() - new Date(a.paid_at ?? a.created_at).getTime(),
    ).slice(0, 50);
  } else {
    const result = await q.order("created_at", { ascending: false }).limit(50);
    rows = result.data;
    error = result.error;
  }
  if (error) {
    console.error("[bills] list:", error);
    return NextResponse.json({ error: "Failed to load bills" }, { status: 500 });
  }

  const groupIds = [...new Set((rows ?? []).map((r) => r.group_id))];
  const memberIdSet = new Set<string>();
  for (const r of rows ?? []) {
    memberIdSet.add(r.payer_member_id);
    memberIdSet.add(r.receiver_member_id);
  }

  const [{ data: groups }, { data: members }] = await Promise.all([
    groupIds.length
      ? db.from("groups").select("id, name").in("id", groupIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    memberIdSet.size
      ? db.from("group_members").select("id, display_name, user_id").in("id", [...memberIdSet])
      : Promise.resolve({ data: [] as { id: string; display_name: string | null; user_id: string | null }[] }),
  ]);

  const groupName = new Map((groups ?? []).map((g) => [g.id, g.name]));
  const memberName = new Map((members ?? []).map((m) => [m.id, m.display_name ?? "Unknown"]));

  const bills = (rows ?? []).map((r) => ({
    id: r.id,
    groupId: r.group_id,
    groupName: groupName.get(r.group_id) ?? "Group",
    label: r.label ?? "Bill",
    amount: Number(r.amount),
    currency: r.currency,
    status: r.status,
    resolutionMethod: r.resolution_method,
    payerMemberId: r.payer_member_id,
    receiverMemberId: r.receiver_member_id,
    payerName: memberName.get(r.payer_member_id) ?? "Someone",
    receiverName: memberName.get(r.receiver_member_id) ?? "Someone",
    payUrl: payUrlForStoredToken(r.pay_link_token),
    createdAt: r.created_at,
    paidAt: r.paid_at,
    lastNudgedAt: r.last_nudged_at,
    isPayer: memberIds.includes(r.payer_member_id),
    isReceiver: memberIds.includes(r.receiver_member_id),
  }));

  const [{ count: toPayCount }, { count: waitingCount }] = await Promise.all([
    db
      .from("payment_requests")
      .select("id", { count: "exact", head: true })
      .in("payer_member_id", memberIds)
      .eq("status", "pending"),
    db
      .from("payment_requests")
      .select("id", { count: "exact", head: true })
      .in("receiver_member_id", memberIds)
      .eq("status", "pending"),
  ]);

  return NextResponse.json({
    bills,
    counts: { to_pay: toPayCount ?? 0, waiting_on: waitingCount ?? 0 },
  });
}

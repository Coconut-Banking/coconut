export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { revalidateTag } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import { CACHE_TAGS } from "@/lib/cached-queries";
import { canAccessGroup } from "@/lib/group-access";
import { paidAmountFromSplitRow } from "@/lib/split-transaction-helpers";
import {
  buildMemberNameMap,
  collectMissingAssigneeNames,
  peopleToEnsureInGroup,
  resolveAssignmentMemberId,
  type ReceiptFinishPerson,
} from "@/lib/receipt-finish-members";
import { findClerkUserIdByEmail } from "@/lib/clerk-user-lookup";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const [{ userId }, { id }, body] = await Promise.all([
    auth(),
    params,
    req.json().catch(() => null) as Promise<{
      groupId?: string;
      people?: Array<{ name?: string; email?: string | null }>;
    } | null>,
  ]);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { groupId } = body;

  if (!groupId) {
    return NextResponse.json({ error: "groupId required" }, { status: 400 });
  }

  const db = getSupabase();

  // Fetch receipt, access check, group, and members in parallel
  const [receiptResult, allowedResult, groupResult, membersResult] = await Promise.all([
    db
      .from("receipt_scans")
      .select(`
        *,
        receipt_items(
          id,
          name,
          quantity,
          unit_price,
          total_price,
          receipt_assignments(
            assignee_name,
            member_id
          )
        )
      `)
      .eq("id", id)
      .eq("clerk_user_id", userId)
      .single(),
    canAccessGroup(userId, groupId),
    db.from("groups").select("id, name").eq("id", groupId).single(),
    db.from("group_members").select("id, display_name, user_id, email").eq("group_id", groupId),
  ]);

  const { data: receipt, error: receiptError } = receiptResult;
  if (receiptError || !receipt) {
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  }
  if (!allowedResult) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { data: group, error: groupError } = groupResult;
  if (groupError || !group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }
  let members = membersResult.data ?? [];
  if (members.length === 0) {
    return NextResponse.json({ error: "No members in group" }, { status: 400 });
  }

  const people: ReceiptFinishPerson[] = Array.isArray(body.people)
    ? body.people
        .filter((p) => typeof p?.name === "string" && p.name.trim())
        .map((p) => ({
          name: p.name!.trim(),
          email: typeof p.email === "string" ? p.email : null,
        }))
    : [];

  const assigneeNames: string[] = [];
  for (const item of receipt.receipt_items ?? []) {
    for (const a of item.receipt_assignments ?? []) {
      if (a.assignee_name) assigneeNames.push(a.assignee_name);
    }
  }

  let memberByName = buildMemberNameMap(members);
  const missingNames = collectMissingAssigneeNames(assigneeNames, memberByName);
  const toAdd = peopleToEnsureInGroup(people, missingNames);

  for (const person of toAdd) {
    const key = person.name.toLowerCase();
    if (memberByName.has(key)) continue;

    let linkedUserId: string | null = null;
    const email = person.email?.trim().toLowerCase() ?? null;
    if (email) {
      linkedUserId = await findClerkUserIdByEmail(email);
    }

    const { data: inserted, error: insertErr } = await db
      .from("group_members")
      .insert({
        group_id: groupId,
        user_id: linkedUserId,
        email,
        display_name: person.name.slice(0, 100),
      })
      .select("id, display_name, user_id, email")
      .single();

    if (insertErr) {
      console.error("[receipt/finish] add member:", insertErr.message, person.name);
      continue;
    }
    if (inserted) {
      members = [...members, inserted];
      memberByName = buildMemberNameMap(members);
    }
  }

  const memberIdsInGroup = new Set(members.map((m) => m.id));

  // Find the payer (current user's member ID)
  const payerMember = members.find(m => m.user_id === userId);
  if (!payerMember) {
    return NextResponse.json({ error: "You are not a member of this group" }, { status: 400 });
  }

  // Calculate total tax and tip to distribute
  const subtotal = receipt.subtotal || 0;
  const tax = receipt.tax || 0;
  const tip = receipt.tip || 0;
  const extraPercentage = subtotal > 0 ? (tax + tip) / subtotal : 0;

  // Process assignments and create shares
  const sharesByMember = new Map<string, number>();

  for (const item of receipt.receipt_items || []) {
    const itemPrice = item.total_price || 0;
    const itemWithExtra = itemPrice * (1 + extraPercentage);
    const assignments = item.receipt_assignments || [];

    if (assignments.length > 0) {
      const shareAmount = itemWithExtra / assignments.length;

      for (const assignment of assignments) {
        const memberId = resolveAssignmentMemberId(
          assignment,
          memberByName,
          memberIdsInGroup,
        );

        if (!memberId) continue;

        const current = sharesByMember.get(memberId) || 0;
        sharesByMember.set(memberId, current + shareAmount);
      }
    }
  }

  const merchantName = receipt.merchant_name || "Receipt Split";
  const total = receipt.total || 0;
  const sharesPayload = Array.from(sharesByMember.entries()).map(([memberId, amount]) => ({
    memberId,
    amount: Math.round(amount * 100) / 100,
  }));

  const { data: rpcResult, error: rpcErr } = await db.rpc("finish_receipt_split", {
    p_clerk_user_id: userId,
    p_group_id: groupId,
    p_payer_member_id: payerMember.id,
    p_merchant_name: merchantName,
    p_total: total,
    p_currency: "USD",
    p_shares: sharesPayload,
  });

  if (rpcErr) {
    console.error("[receipt/finish] RPC error:", rpcErr.message);
    return NextResponse.json(
      { error: rpcErr.message ?? "Failed to finish receipt split" },
      { status: 500 }
    );
  }

  const result = rpcResult as {
    txId?: string;
    splitTxId?: string;
    shares?: number;
    error?: string;
  };
  if (result.error) {
    const status = result.error === "Not a member" ? 400 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }
  if (!result.txId || !result.splitTxId) {
    return NextResponse.json({ error: "Failed to finish receipt split" }, { status: 500 });
  }

  const transactionId = result.txId;
  const splitTxId = result.splitTxId;

  revalidateTag(CACHE_TAGS.splitTransactions(userId), "max");
  revalidateTag(CACHE_TAGS.transactions(userId), "max");

  // Run receipt status update, module import, and balance queries all in parallel
  const [, { computeBalances, getSuggestedSettlements }, splitsResult, settlementsResult] = await Promise.all([
    db
      .from("receipt_scans")
      .update({ status: "completed" })
      .eq("id", id)
      .eq("clerk_user_id", userId),
    import("@/lib/split-balances"),
    db
      .from("split_transactions")
      .select(`
        id,
        transaction_id,
        transactions(amount)
      `)
      .eq("group_id", groupId),
    db
      .from("settlements")
      .select("payer_member_id, receiver_member_id, amount")
      .eq("group_id", groupId)
      .eq("status", "completed"),
  ]);

  const allSplits = splitsResult.data ?? [];
  const settlements = settlementsResult.data ?? [];

  // Get all shares (depends on split IDs)
  const allSplitIds = allSplits.map(s => s.id);
  const { data: allShares } = allSplitIds.length > 0
    ? await db
        .from("split_shares")
        .select("split_transaction_id, member_id, amount")
        .in("split_transaction_id", allSplitIds)
    : { data: [] as { split_transaction_id: string; member_id: string; amount: number }[] };

  // Build paid rows (who paid for transactions)
  const paidRows: { member_id: string; amount: number }[] = [];
  for (const split of allSplits ?? []) {
    // Find who paid (for now, assume the payer is the one who created the split)
    // In our case, it's the current user's member
    const amt = paidAmountFromSplitRow(
      split as { transactions?: unknown; amount?: number | string | null }
    );
    paidRows.push({ member_id: payerMember.id, amount: amt });
  }

  // Build owed rows from shares
  const owedRows = (allShares ?? []).map(share => ({
    member_id: share.member_id,
    amount: Number(share.amount)
  }));

  const paidSettlements = (settlements ?? []).map(s => ({
    payer_member_id: s.payer_member_id,
    amount: Number(s.amount)
  }));

  const receivedSettlements = (settlements ?? []).map(s => ({
    receiver_member_id: s.receiver_member_id,
    amount: Number(s.amount)
  }));

  const balances = computeBalances(paidRows, owedRows, paidSettlements, receivedSettlements);
  const suggestions = getSuggestedSettlements(balances);

  // Map member IDs to names
  const memberMap = new Map(members.map(m => [m.id, m.display_name || "Unknown"]));

  const balancesWithNames = Array.from(balances.values()).map(b => ({
    ...b,
    name: memberMap.get(b.memberId) || "Unknown"
  }));

  const suggestionsWithNames = suggestions.map(s => ({
    ...s,
    fromName: memberMap.get(s.fromMemberId) || "Unknown",
    toName: memberMap.get(s.toMemberId) || "Unknown"
  }));

  const groupName = (group as { name?: string }).name || "Shared expenses";

  return NextResponse.json({
    ok: true,
    transactionId,
    splitId: splitTxId,
    groupId: groupId,
    groupName,
    members: members.map((m) => ({
      id: m.id,
      displayName: m.display_name || "Unknown",
      email: m.email ?? null,
    })),
    balances: balancesWithNames,
    suggestions: suggestionsWithNames,
  });
}
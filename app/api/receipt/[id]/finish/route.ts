import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { revalidateTag } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import { CACHE_TAGS } from "@/lib/cached-queries";
import { canAccessGroup } from "@/lib/group-access";
import { randomUUID } from "crypto";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { groupId } = body;

  if (!groupId) {
    return NextResponse.json({ error: "groupId required" }, { status: 400 });
  }

  const db = getSupabase();

  // Get receipt details with items and assignments
  const { data: receipt, error: receiptError } = await db
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
    .single();

  if (receiptError || !receipt) {
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  }

  const allowed = await canAccessGroup(userId, groupId);
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: group, error: groupError } = await db
    .from("groups")
    .select("id, name")
    .eq("id", groupId)
    .single();

  if (groupError || !group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  // Get group members (include email for payment requests)
  const { data: members } = await db
    .from("group_members")
    .select("id, display_name, user_id, email")
    .eq("group_id", groupId);

  if (!members || members.length === 0) {
    return NextResponse.json({ error: "No members in group" }, { status: 400 });
  }

  // Find the payer (current user's member ID)
  const payerMember = members.find(m => m.user_id === userId);
  if (!payerMember) {
    return NextResponse.json({ error: "You are not a member of this group" }, { status: 400 });
  }

  // Create a transaction for the receipt
  const { data: transaction, error: txError } = await db
    .from("transactions")
    .insert({
      clerk_user_id: userId,
      plaid_transaction_id: `manual_${randomUUID()}`,
      merchant_name: receipt.merchant_name || "Receipt Split",
      raw_name: receipt.merchant_name || "Receipt Split",
      amount: -(receipt.total || 0),
      date: new Date().toISOString().split('T')[0],
      is_pending: false,
      primary_category: "Food & Drink",
      detailed_category: null,
    })
    .select()
    .single();

  if (txError || !transaction) {
    return NextResponse.json({ error: "Failed to create transaction" }, { status: 500 });
  }

  // Create split transaction
  const { data: splitTx, error: splitError } = await db
    .from("split_transactions")
    .insert({
      group_id: groupId,
      transaction_id: transaction.id,
      created_by: userId,
    })
    .select()
    .single();

  if (splitError || !splitTx) {
    // Rollback transaction
    await db.from("transactions").delete().eq("id", transaction.id);
    return NextResponse.json({ error: "Failed to create split" }, { status: 500 });
  }

  // Calculate total tax and tip to distribute
  const subtotal = receipt.subtotal || 0;
  const tax = receipt.tax || 0;
  const tip = receipt.tip || 0;
  const extraPercentage = subtotal > 0 ? (tax + tip) / subtotal : 0;

  // Create member name to ID mapping
  const memberByName = new Map(
    members.map(m => [m.display_name?.toLowerCase(), m.id])
  );

  // Process assignments and create shares
  const sharesByMember = new Map<string, number>();

  for (const item of receipt.receipt_items || []) {
    const itemPrice = item.total_price || 0;
    const itemWithExtra = itemPrice * (1 + extraPercentage);
    const assignments = item.receipt_assignments || [];

    if (assignments.length > 0) {
      const shareAmount = itemWithExtra / assignments.length;

      for (const assignment of assignments) {
        // Try to match assignment to group member
        let memberId = assignment.member_id;

        if (!memberId) {
          // Try to find member by name
          memberId = memberByName.get(assignment.assignee_name?.toLowerCase()) || null;
        }

        if (!memberId) {
          // If no match, create as guest member or skip
          continue;
        }

        const current = sharesByMember.get(memberId) || 0;
        sharesByMember.set(memberId, current + shareAmount);
      }
    }
  }

  // Insert split shares
  const shares = Array.from(sharesByMember.entries()).map(([memberId, amount]) => ({
    split_transaction_id: splitTx.id,
    member_id: memberId,
    amount: Math.round(amount * 100) / 100, // Round to 2 decimal places
  }));

  if (shares.length > 0) {
    const { error: sharesError } = await db
      .from("split_shares")
      .insert(shares);

    if (sharesError) {
      // Rollback
      await db.from("split_transactions").delete().eq("id", splitTx.id);
      await db.from("transactions").delete().eq("id", transaction.id);
      return NextResponse.json({ error: "Failed to create shares" }, { status: 500 });
    }
  }

  revalidateTag(CACHE_TAGS.splitTransactions(userId));
  revalidateTag(CACHE_TAGS.transactions(userId));

  // Update receipt status to completed
  await db
    .from("receipt_scans")
    .update({ status: "completed" })
    .eq("id", id);

  // Fetch updated balances for the group
  const { computeBalances, getSuggestedSettlements } = await import("@/lib/split-balances");

  // Get all splits for this group
  const { data: allSplits } = await db
    .from("split_transactions")
    .select(`
      id,
      transaction_id,
      transactions(amount)
    `)
    .eq("group_id", groupId);

  // Get all shares
  const allSplitIds = (allSplits ?? []).map(s => s.id);
  const { data: allShares } = allSplitIds.length > 0
    ? await db
        .from("split_shares")
        .select("split_transaction_id, member_id, amount")
        .in("split_transaction_id", allSplitIds)
    : { data: [] as { split_transaction_id: string; member_id: string; amount: number }[] };

  // Get settlements
  const { data: settlements } = await db
    .from("settlements")
    .select("payer_member_id, receiver_member_id, amount")
    .eq("group_id", groupId)
    .eq("status", "completed");

  // Build paid rows (who paid for transactions)
  const paidRows: { member_id: string; amount: number }[] = [];
  for (const split of allSplits ?? []) {
    // Find who paid (for now, assume the payer is the one who created the split)
    // In our case, it's the current user's member
    const tx = split.transactions as { amount?: number };
    paidRows.push({
      member_id: payerMember.id,
      amount: Math.abs(tx?.amount ?? 0)
    });
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
    transactionId: transaction.id,
    splitId: splitTx.id,
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
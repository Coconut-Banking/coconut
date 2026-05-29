"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { InlineBillPay } from "@/components/pay/InlineBillPay";

type PayPreview = {
  amount: number;
  currency: string;
  payerName: string;
  receiverName: string;
  groupName: string;
  description: string;
  payable: boolean;
  notPayableReason: string | null;
};

export function PayLinkCheckoutClient({
  token,
  initialPaid,
  initialCancelled,
}: {
  token: string;
  initialPaid: boolean;
  initialCancelled: boolean;
}) {
  const searchParams = useSearchParams();
  const paid =
    initialPaid ||
    searchParams.get("paid") === "1" ||
    searchParams.get("redirect_status") === "succeeded";

  const [preview, setPreview] = useState<PayPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [justPaid, setJustPaid] = useState(false);

  useEffect(() => {
    let cancelledReq = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/pay/${encodeURIComponent(token)}`);
        const data = await res.json();
        if (!res.ok) {
          if (!cancelledReq) setError(data.error ?? "Invalid payment link");
          return;
        }
        if (!cancelledReq) setPreview(data as PayPreview);
      } catch {
        if (!cancelledReq) setError("Could not load payment details");
      } finally {
        if (!cancelledReq) setLoading(false);
      }
    })();
    return () => {
      cancelledReq = true;
    };
  }, [token]);

  const formatMoney = (amount: number, currency: string) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm"
      >
        <p className="text-sm text-gray-500">Loading payment…</p>
      </motion.div>
    );
  }

  if (error && !preview) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-red-100 bg-white p-8 text-center shadow-sm"
      >
        <p className="text-base font-semibold text-gray-900">Link unavailable</p>
        <p className="mt-2 text-sm text-gray-500">{error}</p>
      </motion.div>
    );
  }

  if (paid || justPaid) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm"
      >
        <motion.div
          initial={{ scale: 0.9 }}
          animate={{ scale: 1 }}
          className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#EEF5F0] text-2xl text-[#3A7D44]"
        >
          ✓
        </motion.div>
        <p className="text-xl font-bold text-gray-900">Payment sent</p>
        <p className="mt-2 text-sm text-gray-500">
          {preview
            ? `${formatMoney(preview.amount, preview.currency)} to ${preview.receiverName} was processed.`
            : "Your payment was processed."}
        </p>
      </motion.div>
    );
  }

  if (!preview) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm"
    >
      <p className="text-center text-xs font-semibold uppercase tracking-wider text-gray-400">
        Your share
      </p>
      <p className="mt-3 text-center text-sm text-gray-600">
        {preview.payerName} → {preview.receiverName}
      </p>
      <p className="mt-2 text-center text-4xl font-bold tracking-tight text-[#1e2021]">
        {formatMoney(preview.amount, preview.currency)}
      </p>
      <p className="mt-1 text-center text-xs text-gray-400">{preview.groupName}</p>

      {initialCancelled ? (
        <p className="mt-4 text-center text-sm text-amber-700">Payment cancelled — you can try again.</p>
      ) : null}

      {!preview.payable && preview.notPayableReason ? (
        <p className="mt-6 rounded-xl bg-gray-50 px-4 py-3 text-center text-sm text-gray-600">
          {preview.notPayableReason}
        </p>
      ) : (
        <div className="mt-8">
          <InlineBillPay token={token} onPaid={() => setJustPaid(true)} />
          <p className="mt-4 text-center text-xs text-gray-400">
            Tap Apple Pay below — stays on this page, no redirect
          </p>
          <a
            href={`coconut://pay/${encodeURIComponent(token)}`}
            className="mt-6 block text-center text-sm font-medium text-[#1e2021] underline-offset-2 hover:underline"
          >
            Open in Coconut app
          </a>
        </div>
      )}
    </motion.div>
  );
}

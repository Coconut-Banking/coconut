"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  ExpressCheckoutElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";

function ExpressPayConfirm({
  returnUrl,
  onPaid,
  onError,
}: {
  returnUrl: string;
  onPaid: () => void;
  onError: (message: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();

  const onConfirm = useCallback(async () => {
    if (!stripe || !elements) return;
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
      redirect: "if_required",
    });
    if (error) {
      onError(error.message ?? "Payment failed");
      return;
    }
    if (paymentIntent?.status === "succeeded") {
      onPaid();
    }
  }, [stripe, elements, returnUrl, onPaid, onError]);

  return (
    <ExpressCheckoutElement
      onConfirm={onConfirm}
      options={{
        buttonHeight: 48,
        layout: { maxColumns: 1, maxRows: 1, overflow: "never" },
      }}
    />
  );
}

export function InlineBillPay({
  token,
  onPaid,
  className,
}: {
  token: string;
  onPaid?: () => void;
  className?: string;
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [publishableKey, setPublishableKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paid, setPaid] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/pay/${encodeURIComponent(token)}/intent`, {
          method: "POST",
        });
        const data = (await res.json()) as {
          clientSecret?: string;
          publishableKey?: string;
          error?: string;
        };
        if (!res.ok || !data.clientSecret || !data.publishableKey) {
          if (!cancelled) setError(data.error ?? "Could not start payment");
          return;
        }
        if (!cancelled) {
          setClientSecret(data.clientSecret);
          setPublishableKey(data.publishableKey);
        }
      } catch {
        if (!cancelled) setError("Could not start payment");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const returnUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    const url = new URL(window.location.href);
    url.searchParams.set("paid", "1");
    return url.toString();
  }, []);

  const stripePromise = useMemo(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [publishableKey],
  );

  const handlePaid = useCallback(() => {
    setPaid(true);
    onPaid?.();
  }, [onPaid]);

  if (paid) {
    return <p className="text-sm font-semibold text-[#3A7D44]">Paid ✓</p>;
  }

  if (loading) {
    return <p className="text-sm text-gray-500">Loading payment…</p>;
  }

  if (error || !clientSecret || !stripePromise) {
    return (
      <p className="text-sm text-red-600">{error ?? "Payments unavailable right now"}</p>
    );
  }

  return (
    <div className={className}>
      <Elements
        stripe={stripePromise}
        options={{
          clientSecret,
          appearance: {
            theme: "stripe",
            variables: {
              borderRadius: "12px",
              colorPrimary: "#1e2021",
            },
          },
        }}
      >
        <ExpressPayConfirm returnUrl={returnUrl} onPaid={handlePaid} onError={setError} />
      </Elements>
      {error ? <p className="mt-2 text-center text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

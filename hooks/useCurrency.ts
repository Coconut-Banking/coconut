"use client";

import { useUser } from "@clerk/nextjs";
import { useCallback, useMemo } from "react";
import {
  DEFAULT_CURRENCY_CODE,
  SUPPORTED_CURRENCIES,
  formatCurrency as fmtCurrency,
  formatCurrencyAbs as fmtCurrencyAbs,
  getCurrencySymbol as getSymbol,
} from "@/lib/currency";
import type { CurrencyCode } from "@/lib/currency";

export function useCurrency() {
  const { user } = useUser();

  const currencyCode: CurrencyCode = useMemo(() => {
    const stored = (user?.unsafeMetadata as { currency?: string } | undefined)?.currency;
    if (stored && SUPPORTED_CURRENCIES.some((c) => c.code === stored)) {
      return stored as CurrencyCode;
    }
    return DEFAULT_CURRENCY_CODE as CurrencyCode;
  }, [user?.unsafeMetadata]);

  const format = useCallback(
    (amount: number) => fmtCurrency(amount, currencyCode),
    [currencyCode]
  );

  const formatAbs = useCallback(
    (amount: number) => fmtCurrencyAbs(amount, currencyCode),
    [currencyCode]
  );

  const symbol = useMemo(() => getSymbol(currencyCode), [currencyCode]);

  const setCurrency = useCallback(
    async (code: CurrencyCode) => {
      if (!user) return;
      await user.update({
        unsafeMetadata: { ...user.unsafeMetadata, currency: code },
      });
    },
    [user]
  );

  return { currencyCode, symbol, format, formatAbs, setCurrency };
}

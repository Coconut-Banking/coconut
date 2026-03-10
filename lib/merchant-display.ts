/**
 * Clean merchant names for display — bank raw strings are often unreadable.
 * Applied after Plaid, before UI.
 */
export function cleanMerchantForDisplay(
  raw: string,
  category: string
): string {
  const cat = category.toUpperCase().replace(/\s/g, "_");
  let s = raw.trim();
  if (!s) return raw;

  // 1. Wire/ACH transfers: "REAL TIME TRANSFER RECD ... FROM: Company Inc Via WISE ..."
  const fromMatch = s.match(/FROM:\s*([^/]+?)(?=\s*(?:\/|Via\s|REF:|DATAB|$))/i);
  if (fromMatch) {
    const company = fromMatch[1].trim();
    if (company.length > 1 && /^[A-Za-z\s&.]+$/.test(company)) {
      return ["INCOME", "TRANSFER_IN"].includes(cat) ? `${company} Pay` : company;
    }
  }

  // 2. Zelle: "Zelle payment to Brendan Eggen JPM99c5ng32u" → "Zelle to Brendan Eggen"
  if (/zelle/i.test(s)) {
    const toMatch = s.match(/zelle\s+(?:payment\s+)?to\s+(.+?)(?:\s+[A-Z0-9]{8,}$|\s*$)/i);
    if (toMatch) return `Zelle to ${toMatch[1].trim()}`;
    return "Zelle Payment";
  }

  // 3. ATM
  if (/NON-CHASE\s+ATM\s+FEE/i.test(s)) return "ATM Fee";
  if (/NON-CHASE\s+ATM\s+WITHDRAW/i.test(s)) return "ATM Withdrawal";
  if (/ATM\s+(FEE|WITHDRAW|DEPOSIT)/i.test(s)) {
    const m = s.match(/ATM\s+(FEE|WITHDRAW|DEPOSIT)/i);
    return m ? `ATM ${m[1]}` : "ATM";
  }

  // 4. Account transfer labels: "Acc Kalshi Acc Fund", "Kalshi Kalshi Acc Pay"
  if (/^Acc\s+\w+\s+Acc\s+Fund/i.test(s)) {
    const m = s.match(/Acc\s+(\w+)/i);
    return m ? `${m[1]} Transfer` : "Transfer Out";
  }
  if (/\w+\s+\w+\s+Acc\s+Pay$/i.test(s)) {
    const m = s.match(/^(\w+)\s/);
    return m ? m[1] : s;
  }

  // 5. INCOME/TRANSFER_IN: payroll junk (PPD ID, -OSV, etc.)
  const incomeCategories = ["INCOME", "TRANSFER_IN"];
  if (incomeCategories.includes(cat)) {
    const hasPayrollJunk =
      /PPD\s*ID|-OSV|ACH\s+CREDIT|DIRECT\s+DEP|PAYROLL|DIR\s+DEP|CREDIT\s+ENTRY/i.test(s);
    if (hasPayrollJunk) {
      let company = s.split(",")[0].trim();
      if (!s.includes(",")) {
        const match = s.match(/^(.+?)\s+(?:PPD\s*ID|-OSV|PAYROLL|ACH|DIRECT\s+DEP)/i);
        if (match) company = match[1].trim();
      }
      if (company.length >= 2 && !/\b(PAY|PAYROLL|SALARY|DEPOSIT|CREDIT)\b/i.test(company)) {
        return `${company} Pay`;
      }
      return company;
    }
  }

  // 6. Trim redundant "Sport And Physi Sport" style duplication (Soma Sport And Physi Sport)
  if (/\s+And\s+Physi\s+Sport$/i.test(s)) {
    return s.replace(/\s+And\s+Physi\s+Sport$/i, " & Physio");
  }

  return s;
}

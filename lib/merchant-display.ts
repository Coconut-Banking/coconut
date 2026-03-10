/**
 * Clean merchant names for display, especially income/payroll transactions
 * that often have technical junk (PPD ID, -OSV, etc.).
 */
export function cleanMerchantForDisplay(
  raw: string,
  category: string
): string {
  const cat = category.toUpperCase().replace(/\s/g, "_");
  const incomeCategories = ["INCOME", "TRANSFER_IN"];
  if (!incomeCategories.includes(cat)) return raw;

  const hasPayrollJunk =
    /PPD\s*ID|-OSV|ACH\s+CREDIT|DIRECT\s+DEP|PAYROLL|DIR\s+DEP|CREDIT\s+ENTRY/i.test(
      raw
    );
  if (!hasPayrollJunk) return raw;

  // Company name is usually before the first comma
  let company = raw.split(",")[0].trim();
  if (company.length < 2) return raw;

  // If no comma, try splitting before payroll keywords
  if (!raw.includes(",")) {
    const match = raw.match(/^(.+?)\s+(?:PPD\s*ID|-OSV|PAYROLL|ACH|DIRECT\s+DEP)/i);
    if (match) company = match[1].trim();
  }

  // Don't add " Pay" if it already reads as pay/deposit
  if (/\b(PAY|PAYROLL|SALARY|DEPOSIT|CREDIT)\b/i.test(company)) {
    return company;
  }

  return `${company} Pay`;
}

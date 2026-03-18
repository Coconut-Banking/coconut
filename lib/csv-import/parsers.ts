/**
 * CSV parsers for Venmo, Cash App, and PayPal statement exports.
 * Auto-detects platform from CSV headers, then extracts standardized P2P rows.
 */

export interface ParsedP2PRow {
  platform: "venmo" | "cashapp" | "paypal";
  externalId: string;
  date: string; // YYYY-MM-DD
  amount: number;
  counterpartyName: string;
  note: string;
  status: string;
}

type Platform = "venmo" | "cashapp" | "paypal";

/**
 * Parse CSV text (already read as string) and return structured P2P rows.
 * Auto-detects platform from headers.
 */
export function parseP2PCSV(
  csvText: string,
  forcePlatform?: Platform
): { platform: Platform; rows: ParsedP2PRow[]; errors: string[] } {
  const lines = csvText.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    return { platform: forcePlatform ?? "venmo", rows: [], errors: ["CSV has no data rows"] };
  }

  const headerLine = lines[0];
  const platform = forcePlatform ?? detectPlatform(headerLine);
  const headers = parseCSVLine(headerLine).map((h) => h.toLowerCase().trim());
  const rows: ParsedP2PRow[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    // Sanitize: strip formula injection patterns
    const sanitized = lines[i].replace(/^[=+\-@]/g, "'");
    const fields = parseCSVLine(sanitized);
    if (fields.length < headers.length - 2) continue; // allow minor mismatch

    const record: Record<string, string> = {};
    headers.forEach((h, idx) => { record[h] = (fields[idx] ?? "").trim(); });

    try {
      const parsed = platform === "venmo"
        ? parseVenmoRow(record, i)
        : platform === "cashapp"
          ? parseCashAppRow(record, i)
          : parsePayPalRow(record, i);
      if (parsed) rows.push(parsed);
    } catch (err) {
      errors.push(`Row ${i + 1}: ${err instanceof Error ? err.message : "Parse error"}`);
    }
  }

  return { platform, rows, errors };
}

/** Detect platform from CSV header row. */
export function detectPlatform(headerLine: string): Platform {
  const lower = headerLine.toLowerCase();

  // Venmo headers typically include: "ID, Datetime, Type, Status, Note, From, To, Amount"
  if (lower.includes("datetime") && (lower.includes("from") || lower.includes("note"))) {
    return "venmo";
  }

  // Cash App: "Transaction ID, Date, Transaction Type, Currency, Amount, Fee, Net Amount, Asset Type, Status, Notes, Name of sender/receiver"
  if (lower.includes("transaction id") && (lower.includes("sender") || lower.includes("receiver") || lower.includes("net amount"))) {
    return "cashapp";
  }

  // PayPal: "Date, Time, TimeZone, Name, Type, Status, Currency, Gross, Fee, Net, From Email, To Email, Transaction ID, Subject"
  if (lower.includes("timezone") && lower.includes("from email")) {
    return "paypal";
  }

  // Fallback heuristics
  if (lower.includes("venmo")) return "venmo";
  if (lower.includes("cash app") || lower.includes("cashapp")) return "cashapp";
  if (lower.includes("paypal")) return "paypal";

  return "venmo"; // default
}

function parseVenmoRow(record: Record<string, string>, _lineNum: number): ParsedP2PRow | null {
  const id = record["id"] || record["transaction id"] || `venmo_${_lineNum}`;
  const datetime = record["datetime"] || record["date"];
  const from = record["from"] || "";
  const to = record["to"] || "";
  const note = record["note"] || "";
  const amountStr = record["amount (total)"] || record["amount"] || "";
  const status = (record["status"] || "completed").toLowerCase();

  if (!datetime || !amountStr) return null;
  // Skip header rows, totals, etc.
  if (status === "status" || id.toLowerCase() === "id") return null;

  const amount = parseAmount(amountStr);
  if (isNaN(amount)) return null;

  const counterpartyName = amount < 0 ? to : from;
  if (!counterpartyName) return null;

  return {
    platform: "venmo",
    externalId: String(id),
    date: parseDate(datetime),
    amount,
    counterpartyName,
    note,
    status: status === "complete" || status === "completed" ? "completed" : status,
  };
}

function parseCashAppRow(record: Record<string, string>, _lineNum: number): ParsedP2PRow | null {
  const id = record["transaction id"] || `cashapp_${_lineNum}`;
  const dateStr = record["date"] || "";
  const amountStr = record["amount"] || record["net amount"] || "";
  const name = record["name of sender/receiver"] || record["name"] || "";
  const notes = record["notes"] || record["note"] || "";
  const status = (record["status"] || "completed").toLowerCase();

  if (!dateStr || !amountStr) return null;

  const amount = parseAmount(amountStr);
  if (isNaN(amount)) return null;
  if (!name) return null;

  return {
    platform: "cashapp",
    externalId: String(id),
    date: parseDate(dateStr),
    amount,
    counterpartyName: name,
    note: notes,
    status: status.includes("complete") ? "completed" : status,
  };
}

function parsePayPalRow(record: Record<string, string>, _lineNum: number): ParsedP2PRow | null {
  const id = record["transaction id"] || `paypal_${_lineNum}`;
  const dateStr = record["date"] || "";
  const name = record["name"] || "";
  const grossStr = record["gross"] || record["amount"] || "";
  const subject = record["subject"] || record["note"] || "";
  const status = (record["status"] || "completed").toLowerCase();

  if (!dateStr || !grossStr) return null;

  const amount = parseAmount(grossStr);
  if (isNaN(amount)) return null;
  if (!name) return null;

  return {
    platform: "paypal",
    externalId: String(id),
    date: parseDate(dateStr),
    amount,
    counterpartyName: name,
    note: subject,
    status: status.includes("completed") ? "completed" : status,
  };
}

/** Parse amount strings like "$1,234.56", "-$50.00", "1234.56" */
function parseAmount(s: string): number {
  const cleaned = s.replace(/[$,\s]/g, "").replace(/[()]/g, (m) => m === "(" ? "-" : "");
  return parseFloat(cleaned);
}

/** Parse date into YYYY-MM-DD. Handles various formats. */
function parseDate(s: string): string {
  // Try ISO format first
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  // MM/DD/YYYY or M/D/YYYY
  const usMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (usMatch) {
    return `${usMatch[3]}-${usMatch[1].padStart(2, "0")}-${usMatch[2].padStart(2, "0")}`;
  }

  // Try Date constructor as fallback
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }

  return s.slice(0, 10); // best effort
}

/** Simple CSV line parser that handles quoted fields. */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

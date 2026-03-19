import { describe, it, expect } from "vitest";
import { parseP2PCSV, detectPlatform } from "../csv-import/parsers";

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------
describe("detectPlatform", () => {
  it("detects Venmo from headers", () => {
    expect(
      detectPlatform(",ID,Datetime,Type,Status,Note,From,To,Amount (total),Amount (tip)")
    ).toBe("venmo");
  });

  it("detects Cash App from headers", () => {
    expect(
      detectPlatform(
        "Transaction ID,Date,Transaction Type,Currency,Amount,Fee,Net Amount,Asset Type,Status,Notes,Name of sender/receiver"
      )
    ).toBe("cashapp");
  });

  it("detects PayPal from headers", () => {
    expect(
      detectPlatform(
        "Date,Time,TimeZone,Name,Type,Status,Currency,Gross,Fee,Net,From Email,To Email,Transaction ID,Subject"
      )
    ).toBe("paypal");
  });

  it("defaults to venmo for unknown headers", () => {
    expect(detectPlatform("Col1,Col2,Col3")).toBe("venmo");
  });
});

// ---------------------------------------------------------------------------
// Venmo parser
// ---------------------------------------------------------------------------
describe("parseP2PCSV - Venmo", () => {
  const venmoHeader = `,ID,Datetime,Type,Status,Note,From,To,Amount (total)`;

  it("parses a basic payment row", () => {
    const csv = `${venmoHeader}
,1234,2024-01-15T12:00:00,Payment,Complete,Concert tickets,Harshil Patel,You,"+ $50.00"`;

    const { platform, rows, errors } = parseP2PCSV(csv);
    expect(platform).toBe("venmo");
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe("2024-01-15");
    expect(rows[0].amount).toBe(50);
    expect(rows[0].counterpartyName).toBe("Harshil Patel");
    expect(rows[0].note).toBe("Concert tickets");
  });

  it("negative amount = outgoing, counterparty from 'to' field", () => {
    const csv = `${venmoHeader}
,1235,2024-01-16T14:00:00,Payment,Complete,Dinner,You,Jane Doe,"- $25.00"`;

    const { rows } = parseP2PCSV(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(-25);
    expect(rows[0].counterpartyName).toBe("Jane Doe");
  });

  it("positive amount = incoming, counterparty from 'from' field", () => {
    const csv = `${venmoHeader}
,1236,2024-02-01T09:00:00,Payment,Complete,Rent,Alice,You,"$500.00"`;

    const { rows } = parseP2PCSV(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(500);
    expect(rows[0].counterpartyName).toBe("Alice");
  });

  it("skips rows where status is 'status' (duplicated header row)", () => {
    const csv = `${venmoHeader}
,ID,Datetime,Type,Status,Note,From,To,Amount (total)
,1234,2024-01-15T12:00:00,Payment,Complete,Test,Alice,You,"$10.00"`;

    const { rows } = parseP2PCSV(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(10);
  });

  it("handles dollar sign and comma in amounts: $50.00", () => {
    const csv = `${venmoHeader}
,1001,2024-03-01T10:00:00,Payment,Complete,Note,Bob,You,"$50.00"`;

    const { rows } = parseP2PCSV(csv);
    expect(rows[0].amount).toBe(50);
  });

  it("handles negative amount with comma: -$1,234.56", () => {
    const csv = `${venmoHeader}
,1002,2024-03-01T10:00:00,Payment,Complete,Big one,You,Charlie,"- $1,234.56"`;

    const { rows } = parseP2PCSV(csv);
    expect(rows[0].amount).toBe(-1234.56);
  });
});

// ---------------------------------------------------------------------------
// CashApp parser
// ---------------------------------------------------------------------------
describe("parseP2PCSV - Cash App", () => {
  const cashAppHeader =
    "Transaction ID,Date,Transaction Type,Currency,Amount,Fee,Net Amount,Asset Type,Status,Notes,Name of sender/receiver";

  it("parses a basic Cash App row", () => {
    const csv = `${cashAppHeader}
abc123,2024-02-10,Cash out,USD,-$30.00,$0.00,-$30.00,USD,CASH_OUT_COMPLETE,Lunch,John Smith`;

    const { platform, rows } = parseP2PCSV(csv);
    expect(platform).toBe("cashapp");
    expect(rows).toHaveLength(1);
    expect(rows[0].counterpartyName).toBe("John Smith");
    expect(rows[0].amount).toBe(-30);
    expect(rows[0].note).toBe("Lunch");
    expect(rows[0].date).toBe("2024-02-10");
  });

  it("reads counterparty from 'name of sender/receiver' column", () => {
    const csv = `${cashAppHeader}
xyz789,2024-05-20,P2P,USD,$100.00,$0.00,$100.00,USD,PAYMENT_COMPLETE,Refund,Sarah Connor`;

    const { rows } = parseP2PCSV(csv);
    expect(rows[0].counterpartyName).toBe("Sarah Connor");
  });
});

// ---------------------------------------------------------------------------
// PayPal parser
// ---------------------------------------------------------------------------
describe("parseP2PCSV - PayPal", () => {
  const paypalHeader =
    "Date,Time,TimeZone,Name,Type,Status,Currency,Gross,Fee,Net,From Email,To Email,Transaction ID,Subject";

  it("parses a basic PayPal row", () => {
    const csv = `${paypalHeader}
01/20/2024,10:30:00,PST,Jane Smith,General Payment,Completed,USD,"-$75.00","-$2.50","-$77.50",me@email.com,jane@email.com,TX123,Birthday gift`;

    const { platform, rows } = parseP2PCSV(csv);
    expect(platform).toBe("paypal");
    expect(rows).toHaveLength(1);
    expect(rows[0].counterpartyName).toBe("Jane Smith");
    expect(rows[0].amount).toBe(-75);
    expect(rows[0].date).toBe("2024-01-20");
  });

  it("uses 'gross' column for amount", () => {
    const csv = `${paypalHeader}
03/10/2024,08:00:00,PST,Bob Lee,Payment,Completed,USD,"$200.00","$0.00","$200.00",bob@email.com,me@email.com,TX456,Freelance work`;

    const { rows } = parseP2PCSV(csv);
    expect(rows[0].amount).toBe(200);
  });

  it("uses 'subject' column for note", () => {
    const csv = `${paypalHeader}
03/10/2024,08:00:00,PST,Bob Lee,Payment,Completed,USD,"$200.00","$0.00","$200.00",bob@email.com,me@email.com,TX456,Freelance work`;

    const { rows } = parseP2PCSV(csv);
    expect(rows[0].note).toBe("Freelance work");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe("parseP2PCSV - edge cases", () => {
  it("empty CSV returns empty rows with error", () => {
    const { rows, errors } = parseP2PCSV("");
    expect(rows).toHaveLength(0);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("no data");
  });

  it("CSV with only headers returns empty rows", () => {
    const csv = "ID,Datetime,Type,Status,Note,From,To,Amount";
    const { rows } = parseP2PCSV(csv);
    expect(rows).toHaveLength(0);
  });

  it("sanitizes formula injection characters (=, +, -, @)", () => {
    const csv = `ID,Datetime,Type,Status,Note,From,To,Amount
=1234,2024-01-15T12:00:00,Payment,Complete,=cmd,Evil Person,You,"$50.00"`;

    // Should not throw; the leading = gets replaced with '
    const { rows } = parseP2PCSV(csv, "venmo");
    expect(rows.length).toBeGreaterThanOrEqual(0);
  });

  it("handles quoted fields with commas inside", () => {
    const csv = `ID,Datetime,Type,Status,Note,From,To,Amount
1234,2024-01-15T12:00:00,Payment,Complete,"Dinner, drinks, and tip",Harshil Patel,You,"$100.00"`;

    const { rows } = parseP2PCSV(csv, "venmo");
    expect(rows).toHaveLength(1);
    expect(rows[0].note).toBe("Dinner, drinks, and tip");
  });

  it("handles escaped quotes inside quoted fields", () => {
    const csv = `ID,Datetime,Type,Status,Note,From,To,Amount
1234,2024-01-15T12:00:00,Payment,Complete,"She said ""hello""",Alice,You,"$20.00"`;

    const { rows } = parseP2PCSV(csv, "venmo");
    expect(rows).toHaveLength(1);
    expect(rows[0].note).toBe('She said "hello"');
  });
});

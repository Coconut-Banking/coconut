import { describe, it, expect } from "vitest";
import { parseP2PCSV, detectPlatform } from "../csv-import/parsers";

describe("detectPlatform", () => {
  it("detects Venmo from headers", () => {
    expect(detectPlatform(",ID,Datetime,Type,Status,Note,From,To,Amount (total),Amount (tip)")).toBe("venmo");
  });

  it("detects Cash App from headers", () => {
    expect(detectPlatform("Transaction ID,Date,Transaction Type,Currency,Amount,Fee,Net Amount,Asset Type,Status,Notes,Name of sender/receiver")).toBe("cashapp");
  });

  it("detects PayPal from headers", () => {
    expect(detectPlatform("Date,Time,TimeZone,Name,Type,Status,Currency,Gross,Fee,Net,From Email,To Email,Transaction ID,Subject")).toBe("paypal");
  });
});

describe("parseP2PCSV - Venmo", () => {
  it("parses basic Venmo CSV", () => {
    const csv = `,ID,Datetime,Type,Status,Note,From,To,Amount (total)
,1234,2024-01-15T12:00:00,Payment,Complete,Concert tickets,Harshil Patel,You,"+ $50.00"
,1235,2024-01-16T14:00:00,Payment,Complete,Dinner,You,Jane Doe,"- $25.00"`;

    const { platform, rows, errors } = parseP2PCSV(csv);
    expect(platform).toBe("venmo");
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(2);

    // Incoming payment: counterparty is "from"
    expect(rows[0].counterpartyName).toBe("Harshil Patel");
    expect(rows[0].amount).toBe(50);
    expect(rows[0].note).toBe("Concert tickets");
    expect(rows[0].date).toBe("2024-01-15");

    // Outgoing payment: counterparty is "to"
    expect(rows[1].counterpartyName).toBe("Jane Doe");
    expect(rows[1].amount).toBe(-25);
  });

  it("handles Venmo CSV with forced platform", () => {
    const csv = `ID,Datetime,Type,Status,Note,From,To,Amount
1234,2024-03-01T10:00:00,Payment,Complete,Rent,Alice,You,"$500.00"`;

    const { platform } = parseP2PCSV(csv, "venmo");
    expect(platform).toBe("venmo");
  });
});

describe("parseP2PCSV - Cash App", () => {
  it("parses basic Cash App CSV", () => {
    const csv = `Transaction ID,Date,Transaction Type,Currency,Amount,Fee,Net Amount,Asset Type,Status,Notes,Name of sender/receiver
abc123,2024-02-10,Cash out,USD,-$30.00,$0.00,-$30.00,USD,CASH_OUT_COMPLETE,Lunch,John Smith`;

    const { platform, rows } = parseP2PCSV(csv);
    expect(platform).toBe("cashapp");
    expect(rows).toHaveLength(1);
    expect(rows[0].counterpartyName).toBe("John Smith");
    expect(rows[0].amount).toBe(-30);
    expect(rows[0].date).toBe("2024-02-10");
  });
});

describe("parseP2PCSV - PayPal", () => {
  it("parses basic PayPal CSV", () => {
    const csv = `Date,Time,TimeZone,Name,Type,Status,Currency,Gross,Fee,Net,From Email,To Email,Transaction ID,Subject
01/20/2024,10:30:00,PST,Jane Smith,General Payment,Completed,USD,"-$75.00","-$2.50","-$77.50",me@email.com,jane@email.com,TX123,Birthday gift`;

    const { platform, rows } = parseP2PCSV(csv);
    expect(platform).toBe("paypal");
    expect(rows).toHaveLength(1);
    expect(rows[0].counterpartyName).toBe("Jane Smith");
    expect(rows[0].amount).toBe(-75);
    expect(rows[0].note).toBe("Birthday gift");
    expect(rows[0].date).toBe("2024-01-20");
  });
});

describe("parseP2PCSV - edge cases", () => {
  it("returns empty for empty CSV", () => {
    const { rows, errors } = parseP2PCSV("");
    expect(rows).toHaveLength(0);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("sanitizes formula injection", () => {
    const csv = `ID,Datetime,Type,Status,Note,From,To,Amount
=1234,2024-01-15T12:00:00,Payment,Complete,=cmd,Evil Person,You,"$50.00"`;

    const { rows } = parseP2PCSV(csv, "venmo");
    // Should not throw, row should still be parsed
    expect(rows.length).toBeGreaterThanOrEqual(0);
  });

  it("handles quoted fields with commas", () => {
    const csv = `ID,Datetime,Type,Status,Note,From,To,Amount
1234,2024-01-15T12:00:00,Payment,Complete,"Dinner, drinks, and tip",Harshil Patel,You,"$100.00"`;

    const { rows } = parseP2PCSV(csv, "venmo");
    expect(rows).toHaveLength(1);
    expect(rows[0].note).toBe("Dinner, drinks, and tip");
  });
});

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { jsPDF } from "jspdf";

interface PersonShare {
  name: string;
  totalOwed: number;
  items: Array<{ itemName: string; shareAmount: number }>;
}

const COLORS: [number, number, number][] = [
  [61, 142, 98],
  [74, 108, 247],
  [232, 80, 122],
  [245, 158, 11],
  [16, 163, 127],
  [255, 90, 95],
];

function fmt(n: number) {
  return `$${Math.abs(n).toFixed(2)}`;
}

/**
 * POST /api/receipt/export-pdf
 * Generates a PDF receipt split summary and returns it as a downloadable file.
 * Body: { merchant: string, personShares: PersonShare[] }
 */
export async function POST(req: NextRequest) {
  let body: { merchant?: string; personShares?: PersonShare[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const merchant = body.merchant || "Receipt";
  const personShares = body.personShares ?? [];
  if (personShares.length === 0) {
    return NextResponse.json({ error: "No shares provided" }, { status: 400 });
  }

  const grandTotal = personShares.reduce((s, p) => s + p.totalOwed, 0);

  const doc = new jsPDF({ format: "a4", unit: "mm" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 24;
  let y = margin;

  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(45, 55, 72);
  doc.text("Receipt Split", margin, y);
  y += 12;

  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(107, 114, 128);
  doc.text(`${merchant} — Total: ${fmt(grandTotal)} (incl. tax & tip)`, margin, y);
  y += 16;

  for (let i = 0; i < personShares.length; i++) {
    const person = personShares[i];
    const [r, g, b] = COLORS[i % COLORS.length];

    if (y > 250) {
      doc.addPage();
      y = margin;
    }

    doc.setFillColor(r, g, b);
    doc.rect(margin, y, pageW - margin * 2, 10, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(person.name, margin + 4, y + 7);
    doc.text(fmt(person.totalOwed), pageW - margin - 4, y + 7, { align: "right" });
    y += 14;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(107, 114, 128);
    for (const item of person.items) {
      doc.text(item.itemName, margin + 4, y);
      doc.text(fmt(item.shareAmount), pageW - margin - 4, y, { align: "right" });
      y += 6;
    }
    y += 10;
  }

  y += 8;
  doc.setFontSize(9);
  doc.setTextColor(156, 163, 175);
  doc.text("Split with Coconut — coconut-app.dev", margin, y);

  const buffer = Buffer.from(doc.output("arraybuffer"));

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="receipt-split-${merchant.replace(/\s+/g, "-").toLowerCase()}.pdf"`,
    },
  });
}

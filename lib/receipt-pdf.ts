import { jsPDF } from "jspdf";
import type { PersonShare } from "./receipt-split";
import { formatCurrency } from "./currency";

/**
 * Generate a calm, minimal PDF of the receipt split summary.
 * Share with friends so they know how much to pay.
 */
export function exportReceiptSplitPdf(
  merchant: string,
  personShares: PersonShare[],
  filename?: string
): void {
  const doc = new jsPDF({ format: "a4", unit: "mm" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 24;
  let y = margin;

  // Title
  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(45, 55, 72);
  doc.text("Receipt Split", margin, y);
  y += 12;

  // Merchant & total
  const grandTotal = personShares.reduce((s, p) => s + p.totalOwed, 0);
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(107, 114, 128);
  doc.text(
    `${merchant || "Receipt"} — Total: ${formatCurrency(grandTotal)} (incl. tax & tip)`,
    margin,
    y
  );
  y += 16;

  // Per-person sections (RGB for jsPDF)
  const colors: [number, number, number][] = [
    [61, 142, 98],   // #3D8E62
    [74, 108, 247],  // #4A6CF7
    [232, 80, 122],  // #E8507A
    [245, 158, 11],  // #F59E0B
    [16, 163, 127],  // #10A37F
    [255, 90, 95],   // #FF5A5F
  ];

  for (let i = 0; i < personShares.length; i++) {
    const person = personShares[i];
    const [r, g, b] = colors[i % colors.length];

    // Check if we need a new page
    if (y > 250) {
      doc.addPage();
      y = margin;
    }

    // Person header
    doc.setFillColor(r, g, b);
    doc.rect(margin, y, pageW - margin * 2, 10, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(person.name, margin + 4, y + 7);
    doc.text(formatCurrency(person.totalOwed), pageW - margin - 4, y + 7, {
      align: "right",
    });
    y += 14;

    // Items
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(107, 114, 128);
    for (const item of person.items) {
      doc.text(item.itemName, margin + 4, y);
      doc.text(formatCurrency(item.shareAmount), pageW - margin - 4, y, {
        align: "right",
      });
      y += 6;
    }
    y += 10;
  }

  // Footer
  y += 8;
  doc.setFontSize(9);
  doc.setTextColor(156, 163, 175);
  doc.text("Split with Coconut — coconut-app.dev", margin, y);

  doc.save(filename || `receipt-split-${Date.now()}.pdf`);
}

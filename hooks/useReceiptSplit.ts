import { useState, useCallback } from "react";
import {
  distributeExtras,
  computePersonShares,
  type ReceiptItem,
  type ReceiptItemWithExtras,
  type Assignee,
  type PersonShare,
} from "@/lib/receipt-split";

export type Step = "upload" | "review" | "assign" | "summary";

export interface Person {
  name: string;
  memberId: string | null;
}

export function useReceiptSplit() {
  const [step, setStep] = useState<Step>("upload");
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Review step editable fields
  const [editItems, setEditItems] = useState<ReceiptItem[]>([]);
  const [editSubtotal, setEditSubtotal] = useState(0);
  const [editTax, setEditTax] = useState(0);
  const [editTip, setEditTip] = useState(0);
  const [editTotal, setEditTotal] = useState(0);
  const [editMerchant, setEditMerchant] = useState("");

  // Assign step
  const [people, setPeople] = useState<Person[]>([]);
  const [assignments, setAssignments] = useState<Map<string, Assignee[]>>(
    new Map()
  );

  // Computed
  const [itemsWithExtras, setItemsWithExtras] = useState<
    ReceiptItemWithExtras[]
  >([]);
  const [personShares, setPersonShares] = useState<PersonShare[]>([]);

  // Saving state
  const [saving, setSaving] = useState(false);

  const uploadReceipt = useCallback(async (file: File) => {
    setUploading(true);
    setUploadError(null);

    // Preview
    const reader = new FileReader();
    reader.onload = (e) => setImagePreview(e.target?.result as string);
    reader.readAsDataURL(file);

    // Resize image client-side for cost savings
    const resized = await resizeImage(file, 2048);

    const formData = new FormData();
    formData.append("image", resized);

    try {
      const res = await fetch("/api/receipt/parse", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Parse failed");

      const items = (data.receipt_items ?? [])
        .sort(
          (a: { sort_order: number }, b: { sort_order: number }) =>
            a.sort_order - b.sort_order
        );

      setReceiptId(data.id);
      setEditItems(
        items.map(
          (i: { id: string; name: string; quantity: number; unit_price: number; total_price: number }) => ({
            id: i.id,
            name: i.name,
            quantity: Number(i.quantity),
            unitPrice: Number(i.unit_price),
            totalPrice: Number(i.total_price),
          })
        )
      );
      setEditSubtotal(Number(data.subtotal));
      setEditTax(Number(data.tax));
      setEditTip(Number(data.tip));
      setEditTotal(Number(data.total));
      setEditMerchant(data.merchant_name ?? "");
      setStep("review");
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }, []);

  const confirmItems = useCallback(async () => {
    if (!receiptId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/receipt/${receiptId}/items`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: editItems.map((i) => ({
            name: i.name,
            quantity: i.quantity,
            unit_price: i.unitPrice,
            total_price: i.totalPrice,
          })),
          subtotal: editSubtotal,
          tax: editTax,
          tip: editTip,
          total: editTotal,
          merchant_name: editMerchant,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");

      // Update items with new IDs from server
      const serverItems = (data.receipt_items ?? [])
        .sort(
          (a: { sort_order: number }, b: { sort_order: number }) =>
            a.sort_order - b.sort_order
        )
        .map(
          (i: { id: string; name: string; quantity: number; unit_price: number; total_price: number }) => ({
            id: i.id,
            name: i.name,
            quantity: Number(i.quantity),
            unitPrice: Number(i.unit_price),
            totalPrice: Number(i.total_price),
          })
        );
      setEditItems(serverItems);

      const withExtras = distributeExtras(serverItems, editSubtotal, editTax, editTip);
      setItemsWithExtras(withExtras);
      setStep("assign");
    } catch {
      // stay on review step
    } finally {
      setSaving(false);
    }
  }, [receiptId, editItems, editSubtotal, editTax, editTip, editTotal, editMerchant]);

  const addPerson = useCallback(
    (name: string, memberId: string | null = null) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      if (people.some((p) => p.name.toLowerCase() === trimmed.toLowerCase()))
        return;
      setPeople((prev) => [...prev, { name: trimmed, memberId }]);
    },
    [people]
  );

  const removePerson = useCallback((name: string) => {
    setPeople((prev) =>
      prev.filter((p) => p.name.toLowerCase() !== name.toLowerCase())
    );
    setAssignments((prev) => {
      const next = new Map(prev);
      for (const [itemId, assignees] of next) {
        next.set(
          itemId,
          assignees.filter((a) => a.name.toLowerCase() !== name.toLowerCase())
        );
      }
      return next;
    });
  }, []);

  const toggleAssignment = useCallback((itemId: string, person: Person) => {
    setAssignments((prev) => {
      const next = new Map(prev);
      const current = next.get(itemId) ?? [];
      const exists = current.some(
        (a) => a.name.toLowerCase() === person.name.toLowerCase()
      );
      if (exists) {
        next.set(
          itemId,
          current.filter((a) => a.name.toLowerCase() !== person.name.toLowerCase())
        );
      } else {
        next.set(itemId, [
          ...current,
          { name: person.name, memberId: person.memberId },
        ]);
      }
      return next;
    });
  }, []);

  const assignAll = useCallback(
    (itemId: string) => {
      setAssignments((prev) => {
        const next = new Map(prev);
        next.set(
          itemId,
          people.map((p) => ({ name: p.name, memberId: p.memberId }))
        );
        return next;
      });
    },
    [people]
  );

  const computeSummary = useCallback(() => {
    const shares = computePersonShares(itemsWithExtras, assignments);
    setPersonShares(shares);
    setStep("summary");
  }, [itemsWithExtras, assignments]);

  const saveAssignments = useCallback(async () => {
    if (!receiptId) return;
    setSaving(true);
    try {
      const payload = Array.from(assignments.entries()).map(
        ([itemId, assignees]) => ({
          itemId,
          assignees: assignees.map((a) => ({
            name: a.name,
            memberId: a.memberId,
          })),
        })
      );
      await fetch(`/api/receipt/${receiptId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignments: payload }),
      });
    } finally {
      setSaving(false);
    }
  }, [receiptId, assignments]);

  const reset = useCallback(() => {
    setStep("upload");
    setReceiptId(null);
    setImagePreview(null);
    setUploadError(null);
    setEditItems([]);
    setEditSubtotal(0);
    setEditTax(0);
    setEditTip(0);
    setEditTotal(0);
    setEditMerchant("");
    setPeople([]);
    setAssignments(new Map());
    setItemsWithExtras([]);
    setPersonShares([]);
  }, []);

  return {
    step, setStep,
    receiptId, imagePreview, uploading, uploadError, uploadReceipt,
    editItems, setEditItems,
    editSubtotal, setEditSubtotal,
    editTax, setEditTax,
    editTip, setEditTip,
    editTotal, setEditTotal,
    editMerchant, setEditMerchant,
    confirmItems,
    people, addPerson, removePerson,
    assignments, toggleAssignment, assignAll,
    itemsWithExtras, computeSummary,
    personShares, saveAssignments, saving, reset,
  };
}

async function resizeImage(file: File, maxDim: number): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const { width, height } = img;
      if (width <= maxDim && height <= maxDim) {
        resolve(file);
        return;
      }
      const scale = maxDim / Math.max(width, height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => resolve(new File([blob!], file.name, { type: "image/jpeg" })),
        "image/jpeg",
        0.85
      );
    };
    img.src = URL.createObjectURL(file);
  });
}

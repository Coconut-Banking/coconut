"use client";

import {
  Upload,
  Camera,
  Check,
  ChevronRight,
  ChevronLeft,
  Plus,
  X,
  Users,
  Trash2,
  RotateCcw,
  Receipt,
  Loader2,
  CheckCircle2,
  FileDown,
  Send,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useReceiptSplit, type Step } from "@/hooks/useReceiptSplit";
import type { ReceiptItem } from "@/lib/receipt-split";
import { exportReceiptSplitPdf } from "@/lib/receipt-pdf";

const STEPS: { key: Step; label: string }[] = [
  { key: "upload", label: "Upload" },
  { key: "review", label: "Review" },
  { key: "assign", label: "Assign" },
  { key: "summary", label: "Summary" },
];

const PERSON_COLORS = [
  "#3D8E62",
  "#4A6CF7",
  "#E8507A",
  "#F59E0B",
  "#10A37F",
  "#FF5A5F",
  "#9B59B6",
  "#00674B",
];

function personColor(index: number) {
  return PERSON_COLORS[index % PERSON_COLORS.length];
}

export default function ReceiptPage() {
  const rs = useReceiptSplit();
  const currentStepIndex = STEPS.findIndex((s) => s.key === rs.step);

  return (
    <div className="px-4 sm:px-8 py-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-[#EEF7F2] flex items-center justify-center">
          <Receipt size={20} className="text-[#3D8E62]" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
            Split Receipt
          </h1>
          <p className="text-sm text-gray-500">
            Scan a receipt and split items with friends
          </p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1 mb-8">
        {STEPS.map((s, i) => (
          <div key={s.key} className="flex items-center gap-1 flex-1">
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                i < currentStepIndex
                  ? "bg-[#EEF7F2] text-[#3D8E62]"
                  : i === currentStepIndex
                  ? "bg-[#3D8E62] text-white"
                  : "bg-gray-100 text-gray-400"
              }`}
            >
              {i < currentStepIndex ? (
                <Check size={12} />
              ) : (
                <span className="w-4 text-center">{i + 1}</span>
              )}
              <span className="hidden sm:inline">{s.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`h-px flex-1 ${
                  i < currentStepIndex ? "bg-[#3D8E62]" : "bg-gray-200"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={rs.step}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.2 }}
        >
          {rs.step === "upload" && <UploadStep rs={rs} />}
          {rs.step === "review" && <ReviewStep rs={rs} />}
          {rs.step === "assign" && <AssignStep rs={rs} />}
          {rs.step === "summary" && <SummaryStep rs={rs} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/* ─────────────────── Step 1: Upload ─────────────────── */

function UploadStep({ rs }: { rs: ReturnType<typeof useReceiptSplit> }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith("image/")) return;
      rs.uploadReceipt(file);
    },
    [rs]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        role="button"
        aria-label="Upload receipt image"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileRef.current?.click(); }}
        className={`relative border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all ${
          dragOver
            ? "border-[#3D8E62] bg-[#EEF7F2]"
            : "border-gray-200 hover:border-[#3D8E62]/50 hover:bg-[#F7FAF8]"
        }`}
      >
        {rs.uploading ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 size={32} className="text-[#3D8E62] animate-spin" />
            <p className="text-sm font-medium text-gray-700">
              {rs.uploadStage === "uploading"
                ? "Uploading image..."
                : rs.uploadStage === "reading"
                ? "Reading receipt..."
                : rs.uploadStage === "extracting"
                ? "Extracting items..."
                : "Cleaning up..."}
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-[#EEF7F2] flex items-center justify-center">
              <Upload size={24} className="text-[#3D8E62]" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700">
                Drop a receipt image here, or click to browse
              </p>
              <p className="text-xs text-gray-400 mt-1">
                PNG, JPG — photo from camera or screenshot
              </p>
            </div>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </div>

      {/* Camera button for mobile */}
      <button
        onClick={() => fileRef.current?.click()}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors sm:hidden"
      >
        <Camera size={16} />
        Take Photo
      </button>

      {rs.uploadError && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">
          {rs.uploadError}
        </div>
      )}

      {rs.imagePreview && !rs.uploading && (
        <div className="rounded-2xl overflow-hidden border border-gray-100">
          <img
            src={rs.imagePreview}
            alt="Receipt preview"
            className="w-full max-h-64 object-contain bg-gray-50"
          />
        </div>
      )}
    </div>
  );
}

/* ─────────────────── Step 2: Review Items ─────────────────── */

function ReviewStep({ rs }: { rs: ReturnType<typeof useReceiptSplit> }) {
  const otherFeesSum = rs.editOtherFees.reduce((s, f) => s + f.amount, 0);
  const computedTotal = () =>
    Math.round((rs.editSubtotal + rs.editTax + rs.editTip + otherFeesSum) * 100) / 100;

  const syncSubtotalFromItems = (items: typeof rs.editItems) => {
    const sum = Math.round(items.reduce((s, i) => s + i.totalPrice, 0) * 100) / 100;
    rs.setEditSubtotal(sum);
    rs.setEditTotal(Math.round((sum + rs.editTax + rs.editTip + otherFeesSum) * 100) / 100);
  };

  const updateItem = (index: number, field: keyof ReceiptItem, value: string) => {
    rs.setEditItems((prev) => {
      const next = [...prev];
      const item = { ...next[index] };
      if (field === "name") {
        item.name = value;
      } else if (field === "quantity") {
        item.quantity = Number(value) || 0;
        item.totalPrice =
          Math.round(item.quantity * item.unitPrice * 100) / 100;
      } else if (field === "unitPrice") {
        item.unitPrice = Number(value) || 0;
        item.totalPrice =
          Math.round(item.quantity * item.unitPrice * 100) / 100;
      } else if (field === "totalPrice") {
        item.totalPrice = Number(value) || 0;
      }
      next[index] = item;
      syncSubtotalFromItems(next);
      return next;
    });
  };

  const removeItem = (index: number) => {
    rs.setEditItems((prev) => {
      const next = prev.filter((_, i) => i !== index);
      syncSubtotalFromItems(next);
      return next;
    });
  };

  const addItem = () => {
    rs.setEditItems((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}`,
        name: "",
        quantity: 1,
        unitPrice: 0,
        totalPrice: 0,
      },
    ]);
  };

  const recalcSubtotal = () => {
    const sum = rs.editItems.reduce((s, i) => s + i.totalPrice, 0);
    rs.setEditSubtotal(Math.round(sum * 100) / 100);
    rs.setEditTotal(Math.round((sum + rs.editTax + rs.editTip + otherFeesSum) * 100) / 100);
  };

  // Keep Total in sync when Subtotal, Tax, Tip, or Other fees change
  useEffect(() => {
    const total = Math.round((rs.editSubtotal + rs.editTax + rs.editTip + otherFeesSum) * 100) / 100;
    rs.setEditTotal(total);
  }, [rs.editSubtotal, rs.editTax, rs.editTip, rs.editOtherFees]);

  return (
    <div className="space-y-6">
      {/* Merchant */}
      <div>
        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">
          Merchant
        </label>
        <input
          value={rs.editMerchant}
          onChange={(e) => rs.setEditMerchant(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/20 focus:border-[#3D8E62]"
          placeholder="Restaurant name"
        />
      </div>

      {/* Items table */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">
            Items
          </label>
          <button
            onClick={addItem}
            className="flex items-center gap-1 text-xs font-medium text-[#3D8E62] hover:text-[#2D7A52] transition-colors"
          >
            <Plus size={12} />
            Add Item
          </button>
        </div>

        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
          <div className="grid grid-cols-[1fr_60px_80px_80px_32px] gap-2 px-4 py-2 bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wider">
            <span>Name</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Price</span>
            <span className="text-right">Total</span>
            <span />
          </div>

          {rs.editItems.map((item, idx) => (
            <div
              key={item.id}
              className="grid grid-cols-[1fr_60px_80px_80px_32px] gap-2 px-4 py-2 border-t border-gray-50 items-center"
            >
              <input
                value={item.name}
                onChange={(e) => updateItem(idx, "name", e.target.value)}
                className="text-sm border-0 bg-transparent focus:outline-none focus:bg-gray-50 rounded px-1 -mx-1 min-w-0"
                placeholder="Item name"
              />
              <input
                type="number"
                value={item.quantity}
                onChange={(e) => updateItem(idx, "quantity", e.target.value)}
                className="text-sm text-right border-0 bg-transparent focus:outline-none focus:bg-gray-50 rounded px-1 min-w-0"
                min={1}
                step={1}
              />
              <div className="relative">
                <span className="absolute left-1 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                  $
                </span>
                <input
                  type="number"
                  value={item.unitPrice}
                  onChange={(e) =>
                    updateItem(idx, "unitPrice", e.target.value)
                  }
                  className="text-sm text-right border-0 bg-transparent focus:outline-none focus:bg-gray-50 rounded px-1 w-full min-w-0"
                  step={0.01}
                />
              </div>
              <div className="text-sm text-right text-gray-700 font-medium">
                ${item.totalPrice.toFixed(2)}
              </div>
              <button
                onClick={() => removeItem(idx)}
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={recalcSubtotal}
          className="mt-2 text-xs text-[#3D8E62] hover:text-[#2D7A52] font-medium transition-colors"
        >
          ↻ Recalculate subtotal from items
        </button>
      </div>

      {/* Totals */}
      <div className="bg-white border border-gray-100 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">Subtotal</span>
          <div className="relative w-28">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">
              $
            </span>
            <input
              type="number"
              value={rs.editSubtotal}
              onChange={(e) => {
                const v = Number(e.target.value) || 0;
                rs.setEditSubtotal(v);
                rs.setEditTotal(Math.round((v + rs.editTax + rs.editTip + otherFeesSum) * 100) / 100);
              }}
              className="w-full text-right text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/20 focus:border-[#3D8E62]"
              step={0.01}
            />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">Tax</span>
          <div className="relative w-28">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">
              $
            </span>
            <input
              type="number"
              value={rs.editTax}
              onChange={(e) => {
                const v = Number(e.target.value) || 0;
                rs.setEditTax(v);
                rs.setEditTotal(Math.round((rs.editSubtotal + v + rs.editTip + otherFeesSum) * 100) / 100);
              }}
              className="w-full text-right text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/20 focus:border-[#3D8E62]"
              step={0.01}
            />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">Tip</span>
          <div className="relative w-28">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">
              $
            </span>
            <input
              type="number"
              value={rs.editTip}
              onChange={(e) => {
                const v = Number(e.target.value) || 0;
                rs.setEditTip(v);
                rs.setEditTotal(Math.round((rs.editSubtotal + rs.editTax + v + otherFeesSum) * 100) / 100);
              }}
              className="w-full text-right text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/20 focus:border-[#3D8E62]"
              step={0.01}
            />
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Other fees</span>
            <button
              onClick={() => rs.setEditOtherFees((prev) => [...prev, { name: "", amount: 0 }])}
              className="text-xs font-medium text-[#3D8E62] hover:text-[#2D7A52]"
            >
              + Add
            </button>
          </div>
          {rs.editOtherFees.map((fee, idx) => (
              <div key={idx} className="flex items-center justify-between gap-2">
                <input
                  value={fee.name}
                  onChange={(e) => {
                    rs.setEditOtherFees((prev) => {
                      const next = [...prev];
                      next[idx] = { ...next[idx], name: e.target.value };
                      return next;
                    });
                  }}
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/20 min-w-0"
                  placeholder="Fee name"
                />
                <div className="relative w-24 flex items-center gap-1">
                  <span className="text-xs text-gray-400">$</span>
                  <input
                    type="number"
                    value={fee.amount}
                    onChange={(e) => {
                      const v = Number(e.target.value) || 0;
                      rs.setEditOtherFees((prev) => {
                        const next = [...prev];
                        next[idx] = { ...next[idx], amount: v };
                        return next;
                      });
                      rs.setEditTotal(Math.round((rs.editSubtotal + rs.editTax + rs.editTip + otherFeesSum - fee.amount + v) * 100) / 100);
                    }}
                    className="w-full text-right text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/20"
                    step={0.01}
                  />
                  <button
                    onClick={() => {
                      rs.setEditOtherFees((prev) => prev.filter((_, i) => i !== idx));
                      rs.setEditTotal(Math.round((rs.editSubtotal + rs.editTax + rs.editTip + otherFeesSum - fee.amount) * 100) / 100);
                    }}
                    className="w-6 h-6 flex shrink-0 items-center justify-center rounded hover:bg-red-50 text-gray-300 hover:text-red-500"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            ))}
        </div>
        <div className="border-t border-gray-100 pt-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-900">Total</span>
          <span className="text-sm font-semibold text-gray-900">
            ${computedTotal().toFixed(2)}
          </span>
        </div>
      </div>

      {/* Nav */}
      <div className="flex items-center justify-between pt-2">
        <button
          onClick={() => rs.setStep("upload")}
          className="flex items-center gap-1.5 px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
        >
          <ChevronLeft size={14} />
          Back
        </button>
        <button
          onClick={rs.confirmItems}
          disabled={rs.saving || rs.editItems.length === 0}
          className="flex items-center gap-1.5 px-6 py-2.5 bg-[#3D8E62] hover:bg-[#2D7A52] text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
        >
          {rs.saving ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <>
              Continue
              <ChevronRight size={14} />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/* ─────────────────── Step 3: Assign ─────────────────── */

function AssignStep({ rs }: { rs: ReturnType<typeof useReceiptSplit> }) {
  const [newName, setNewName] = useState("");

  const handleAddPerson = (e: React.FormEvent) => {
    e.preventDefault();
    if (newName.trim()) {
      rs.addPerson(newName.trim());
      setNewName("");
    }
  };

  const allAssigned = rs.itemsWithExtras.every(
    (item) => (rs.assignments.get(item.id) ?? []).length > 0
  );

  return (
    <div className="space-y-6">
      {/* People section */}
      <div>
        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
          People at the table
        </label>
        <div className="flex flex-wrap gap-2 mb-3">
          {rs.people.map((person, idx) => (
            <span
              key={person.name}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium text-white"
              style={{ backgroundColor: personColor(idx) }}
            >
              {person.name}
              <button
                onClick={() => rs.removePerson(person.name)}
                className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-white/20 transition-colors"
              >
                <X size={10} />
              </button>
            </span>
          ))}
          {rs.people.length === 0 && (
            <p className="text-sm text-gray-400">
              Add people to start assigning items
            </p>
          )}
        </div>
        <form onSubmit={handleAddPerson} className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/20 focus:border-[#3D8E62]"
            placeholder="Type a name and press Enter"
          />
          <button
            type="submit"
            disabled={!newName.trim()}
            className="px-4 py-2 bg-[#3D8E62] hover:bg-[#2D7A52] text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
          >
            <Plus size={16} />
          </button>
        </form>
      </div>

      {/* Items with assignment */}
      {rs.people.length > 0 && (
        <div className="space-y-3">
          <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider">
            Assign each item
          </label>

          {rs.itemsWithExtras.map((item) => {
            const assigned = rs.assignments.get(item.id) ?? [];
            return (
              <div
                key={item.id}
                className="bg-white border border-gray-100 rounded-2xl p-4"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {item.name}
                    </p>
                    <p className="text-xs text-gray-400">
                      ${item.totalPrice.toFixed(2)} + $
                      {item.proportionalExtra.toFixed(2)} tax/tip ={" "}
                      <span className="font-semibold text-gray-600">
                        ${item.finalPrice.toFixed(2)}
                      </span>
                    </p>
                  </div>
                  <button
                    onClick={() => rs.assignAll(item.id)}
                    className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-[#3D8E62] hover:bg-[#EEF7F2] rounded-lg transition-colors"
                  >
                    <Users size={12} />
                    Everyone
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {rs.people.map((person, pIdx) => {
                    const isAssigned = assigned.some(
                      (a) =>
                        a.name.toLowerCase() === person.name.toLowerCase()
                    );
                    return (
                      <button
                        key={person.name}
                        onClick={() => rs.toggleAssignment(item.id, person)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                          isAssigned
                            ? "text-white shadow-sm"
                            : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                        }`}
                        style={
                          isAssigned
                            ? { backgroundColor: personColor(pIdx) }
                            : {}
                        }
                      >
                        {person.name}
                        {isAssigned && assigned.length > 1 && (
                          <span className="ml-1 opacity-75">
                            $
                            {(item.finalPrice / assigned.length).toFixed(2)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Nav */}
      <div className="flex items-center justify-between pt-2">
        <button
          onClick={() => rs.setStep("review")}
          className="flex items-center gap-1.5 px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
        >
          <ChevronLeft size={14} />
          Back
        </button>
        <button
          onClick={() => {
            rs.saveAssignments();
            rs.computeSummary();
          }}
          disabled={!allAssigned || rs.people.length === 0}
          className="flex items-center gap-1.5 px-6 py-2.5 bg-[#3D8E62] hover:bg-[#2D7A52] text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
        >
          View Summary
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

/* ─────────────────── Step 4: Summary ─────────────────── */

function SummaryStep({ rs }: { rs: ReturnType<typeof useReceiptSplit> }) {
  const grandTotal = rs.personShares.reduce((s, p) => s + p.totalOwed, 0);
  const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [finishing, setFinishing] = useState(false);
  const [finished, setFinished] = useState(false);
  const [groupBalances, setGroupBalances] = useState<Array<{
    memberId: string;
    name: string;
    paid: number;
    owed: number;
    total: number;
  }>>([]);
  const [suggestions, setSuggestions] = useState<Array<{
    fromMemberId: string;
    toMemberId: string;
    fromName: string;
    toName: string;
    amount: number;
  }>>([]);
  const [groupName, setGroupName] = useState("");
  const [members, setMembers] = useState<Array<{ id: string; displayName: string; email: string | null }>>([]);
  const [requestingPayment, setRequestingPayment] = useState<string | null>(null);
  const [paymentLinkCopied, setPaymentLinkCopied] = useState(false);
  const router = useRouter();

  const handleRequestPayment = async (s: {
    fromMemberId: string;
    toMemberId: string;
    fromName: string;
    toName: string;
    amount: number;
  }) => {
    const key = `${s.fromMemberId}-${s.toMemberId}`;
    setRequestingPayment(key);
    try {
      const res = await fetch("/api/stripe/create-payment-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: s.amount,
          description: `${rs.editMerchant || "Receipt"} split`,
          recipientName: s.fromName,
          groupId: selectedGroupId,
          payerMemberId: s.fromMemberId,
          receiverMemberId: s.toMemberId,
        }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        await navigator.clipboard.writeText(data.url);
        setPaymentLinkCopied(true);
        setTimeout(() => setPaymentLinkCopied(false), 2000);
        const payerEmail = members.find((m) => m.id === s.fromMemberId)?.email ?? null;
        if (payerEmail) {
          const subject = encodeURIComponent(`Payment request: $${s.amount.toFixed(2)} for ${groupName || "receipt split"}`);
          const body = encodeURIComponent(
            `Hey!\n\nYou owe me $${s.amount.toFixed(2)} for ${groupName || "our receipt split"}.\n\nPay here: ${data.url}\n\nThanks!`
          );
          window.location.href = `mailto:${payerEmail}?subject=${subject}&body=${body}`;
        }
      } else {
        const payerEmail = members.find((m) => m.id === s.fromMemberId)?.email ?? null;
        if (payerEmail) {
          const subject = encodeURIComponent(`Payment request: $${s.amount.toFixed(2)} for ${groupName || "receipt split"}`);
          const body = encodeURIComponent(
            `Hey!\n\nYou owe me $${s.amount.toFixed(2)} for ${groupName || "our receipt split"}.\n\nPlease pay via Venmo, Cash App, Zelle, or another method.\n\nThanks!`
          );
          window.location.href = `mailto:${payerEmail}?subject=${subject}&body=${body}`;
        } else {
          alert("Add their email in the group to send a payment request, or configure Stripe for payment links.");
        }
      }
    } finally {
      setRequestingPayment(null);
    }
  };

  // Fetch available groups
  useEffect(() => {
    fetch("/api/groups")
      .then((res) => res.json())
      .then((data) => {
        if (data.groups) {
          setGroups(data.groups);
          if (data.groups.length === 1) {
            setSelectedGroupId(data.groups[0].id);
          }
        }
      })
      .catch(() => {});
  }, []);

  const handleFinish = async () => {
    if (!selectedGroupId || !rs.receiptId) return;

    setFinishing(true);
    try {
      const res = await fetch(`/api/receipt/${rs.receiptId}/finish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: selectedGroupId }),
      });

      const data = await res.json();

      if (res.ok) {
        setFinished(true);
        setGroupBalances(data.balances || []);
        setSuggestions(data.suggestions || []);
        setGroupName(data.groupName || "");
        setMembers(data.members || []);

        // Don't redirect immediately - let user see the balances
      } else {
        alert(data.error || "Failed to save to group");
        setFinishing(false);
      }
    } catch (e) {
      alert("Failed to save to group");
      setFinishing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center mb-2">
        <p className="text-sm text-gray-500">
          {rs.editMerchant && (
            <span className="font-medium text-gray-700">
              {rs.editMerchant}
              {" — "}
            </span>
          )}
          Total: ${grandTotal.toFixed(2)} (incl. tax & tip)
        </p>
      </div>

      {/* Export PDF */}
      <div className="flex justify-center">
        <button
          onClick={() =>
            exportReceiptSplitPdf(
              rs.editMerchant,
              rs.personShares,
              `receipt-split-${(rs.editMerchant || "receipt").replace(/\s+/g, "-").toLowerCase()}-${Date.now()}.pdf`
            )
          }
          className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <FileDown size={16} />
          Export PDF
        </button>
      </div>

      {/* Per-person cards */}
      <div className="space-y-3">
        {rs.personShares.map((person, idx) => (
          <div
            key={person.name}
            className="bg-white border border-gray-100 rounded-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-xs font-bold"
                  style={{ backgroundColor: personColor(idx) }}
                >
                  {person.name.slice(0, 2).toUpperCase()}
                </div>
                <span className="text-sm font-semibold text-gray-900">
                  {person.name}
                </span>
              </div>
              <span className="text-lg font-bold text-gray-900">
                ${person.totalOwed.toFixed(2)}
              </span>
            </div>
            <div className="px-4 py-2 space-y-1">
              {person.items.map((item, iIdx) => (
                <div
                  key={iIdx}
                  className="flex items-center justify-between text-xs text-gray-500"
                >
                  <span>{item.itemName}</span>
                  <span>${item.shareAmount.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* No groups — prompt to create */}
      {groups.length === 0 && !finished && (
        <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4">
          <p className="text-sm font-medium text-gray-700">
            Create a group to track and settle
          </p>
          <p className="text-xs text-gray-500 mt-0.5 mb-3">
            Save this split to shared expenses and request payments from friends.
          </p>
          <button
            onClick={() => router.push("/app/shared")}
            className="w-full px-4 py-2.5 bg-[#3D8E62] hover:bg-[#2D7A52] text-white text-sm font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            <Users size={14} />
            Go to Shared Expenses
          </button>
        </div>
      )}

      {/* Save to Group */}
      {groups.length > 0 && !finished && (
        <div className="bg-[#EEF7F2] border border-[#3D8E62]/20 rounded-2xl p-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-sm font-medium text-gray-900">
                Save to Shared Expenses
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Add this receipt split to your group expenses
              </p>
            </div>
            <Users size={16} className="text-[#3D8E62] mt-0.5" />
          </div>

          <div className="space-y-3">
            {groups.length > 1 ? (
              <select
                value={selectedGroupId}
                onChange={(e) => setSelectedGroupId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/20 focus:border-[#3D8E62]"
              >
                <option value="">Select a group...</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            ) : groups.length === 1 ? (
              <div className="px-3 py-2 text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-xl">
                Saving to: <span className="font-medium">{groups[0].name}</span>
              </div>
            ) : null}

            <button
              onClick={handleFinish}
              disabled={!selectedGroupId || finishing}
              className="w-full px-4 py-2.5 bg-[#3D8E62] hover:bg-[#2D7A52] text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {finishing ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check size={14} />
                  Finish & Add to Group
                </>
              )}
            </button>
          </div>
        </div>
      )}


      {finished && (
        <div className="space-y-4">
          {/* Success message */}
          <div className="bg-green-50 border border-green-200 rounded-2xl p-4">
            <div className="flex items-center gap-3 mb-3">
              <CheckCircle2 size={20} className="text-green-600" />
              <p className="text-sm font-medium text-green-900">
                Receipt added to group expenses!
              </p>
            </div>

            {/* Updated balances */}
            {groupBalances.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-600 uppercase tracking-wider mb-2">
                  Updated Group Balances
                </p>
                <div className="space-y-1">
                  {groupBalances.map((balance) => {
                    const isOwed = balance.total > 0;
                    const amount = Math.abs(balance.total);
                    return (
                      <div
                        key={balance.memberId}
                        className="flex items-center justify-between px-3 py-2 bg-white rounded-lg"
                      >
                        <span className="text-sm font-medium text-gray-700">
                          {balance.name}
                        </span>
                        <span className={`text-sm font-semibold ${
                          isOwed ? "text-green-600" : amount > 0.01 ? "text-red-600" : "text-gray-400"
                        }`}>
                          {isOwed ? "+" : amount > 0.01 ? "-" : ""}${amount.toFixed(2)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Settlement suggestions with Request payment */}
            {suggestions.length > 0 && (
              <div className="mt-3 pt-3 border-t border-green-100">
                <p className="text-xs font-medium text-gray-600 uppercase tracking-wider mb-2">
                  Who Owes Whom
                </p>
                <div className="space-y-2">
                  {suggestions.map((s, idx) => (
                    <div key={idx} className="flex items-center justify-between gap-2">
                      <span className="text-xs text-gray-600">
                        <span className="font-medium">{s.fromName}</span>
                        <span> → </span>
                        <span className="font-medium">{s.toName}</span>
                        <span className="text-green-700 font-semibold ml-1">
                          ${s.amount.toFixed(2)}
                        </span>
                      </span>
                      <button
                        onClick={() => handleRequestPayment(s)}
                        disabled={requestingPayment !== null}
                        className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-[#3D8E62] hover:bg-[#EEF7F2] rounded-lg transition-colors disabled:opacity-50 shrink-0"
                      >
                        {requestingPayment === `${s.fromMemberId}-${s.toMemberId}` ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <>
                            <Send size={12} />
                            Request payment
                          </>
                        )}
                      </button>
                    </div>
                  ))}
                </div>
                {paymentLinkCopied && (
                  <p className="text-xs text-[#3D8E62] mt-2">Payment link copied!</p>
                )}
              </div>
            )}
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => router.push("/app/shared")}
              className="px-6 py-2.5 bg-[#3D8E62] hover:bg-[#2D7A52] text-white text-sm font-medium rounded-xl transition-colors"
            >
              View All Expenses
            </button>
            <button
              onClick={rs.reset}
              className="px-4 py-2.5 border border-gray-200 text-sm font-medium text-gray-600 rounded-xl hover:bg-gray-50 transition-colors"
            >
              New Receipt
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center gap-3">
          <button
            onClick={() => rs.setStep("assign")}
            disabled={finishing || finished}
            className="flex items-center gap-1.5 px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors disabled:opacity-50"
          >
            <ChevronLeft size={14} />
            Back
          </button>
          <div className="flex-1" />
          <button
            onClick={rs.reset}
            disabled={finishing}
            className="flex items-center gap-1.5 px-4 py-2.5 border border-gray-200 text-sm font-medium text-gray-600 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <RotateCcw size={14} />
            New Receipt
          </button>
        </div>
      </div>
    </div>
  );
}

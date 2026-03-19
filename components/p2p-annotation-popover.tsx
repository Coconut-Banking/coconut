"use client";

import { useState } from "react";
import { Tag, X, Check, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface P2PAnnotationPopoverProps {
  transactionId: string;
  platform: string | null;
  existingName?: string;
  existingNote?: string;
  onSave: (annotation: { counterpartyName: string; note: string; platform: string | null }) => void;
  onClose: () => void;
}

const PLATFORM_LABELS: Record<string, string> = {
  venmo: "Venmo",
  cashapp: "Cash App",
  paypal: "PayPal",
  zelle: "Zelle",
};

export function P2PAnnotationPopover({
  transactionId: _transactionId,
  platform,
  existingName = "",
  existingNote = "",
  onSave,
  onClose,
}: P2PAnnotationPopoverProps) {
  const [name, setName] = useState(existingName);
  const [note, setNote] = useState(existingNote);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      onSave({ counterpartyName: name.trim(), note: note.trim(), platform });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -4, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -4, scale: 0.98 }}
        transition={{ duration: 0.15 }}
        className="absolute right-0 top-full mt-2 z-30 w-72 bg-white rounded-2xl border border-gray-200 shadow-xl p-4"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Tag size={14} className="text-[#3D8E62]" />
            <span className="text-sm font-semibold text-gray-900">
              {platform ? PLATFORM_LABELS[platform] ?? "P2P" : "P2P"} Details
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400 transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Who was this with?</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Harshil Patel"
              autoFocus
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/20 focus:border-[#3D8E62]"
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Note (optional)</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. concert tickets"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/20 focus:border-[#3D8E62]"
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
            />
          </div>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="w-full flex items-center justify-center gap-2 bg-[#3D8E62] hover:bg-[#2D7A52] disabled:opacity-50 text-white py-2 rounded-xl text-sm font-medium transition-colors"
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Check size={14} />
            )}
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

/** Small tag icon that indicates a P2P transaction can be annotated */
export function P2PTagIcon({
  platform,
  hasAnnotation,
  onClick,
}: {
  platform: string;
  hasAnnotation: boolean;
  onClick: () => void;
}) {
  const label = PLATFORM_LABELS[platform] ?? "P2P";

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full transition-colors ${
        hasAnnotation
          ? "bg-[#EEF7F2] text-[#3D8E62] border border-[#C3E0D3]"
          : "bg-gray-50 text-gray-400 border border-gray-200 hover:bg-gray-100 hover:text-gray-600"
      }`}
      title={hasAnnotation ? `${label} tagged` : `Tag ${label} counterparty`}
    >
      <Tag size={9} />
      <span>{label}</span>
    </button>
  );
}

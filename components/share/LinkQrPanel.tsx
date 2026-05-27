"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

type Props = {
  url: string;
  title?: string;
  subtitle?: string;
};

export function LinkQrPanel({ url, title = "Scan or share", subtitle }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(url, { width: 240, margin: 2 }).then((d) => {
      if (!cancelled) setDataUrl(d);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm">
      <h2 className="text-lg font-bold text-[#1e2021]">{title}</h2>
      {subtitle ? <p className="mt-1 text-sm text-gray-500">{subtitle}</p> : null}
      <div className="mx-auto mt-6 flex h-[260px] w-[260px] items-center justify-center rounded-2xl bg-[#F5F3F2]">
        {dataUrl ? (
          <img src={dataUrl} alt="QR code" width={220} height={220} />
        ) : (
          <p className="text-sm text-gray-400">Generating QR…</p>
        )}
      </div>
      <p className="mt-4 break-all text-xs text-gray-400">{url}</p>
    </div>
  );
}

/**
 * Downscale receipt images before vision/OCR to cut upload + OpenAI latency.
 * Mobile uploads full camera resolution; web resizes client-side — this normalizes both.
 */
const MAX_EDGE_PX = 1280;
const JPEG_QUALITY = 82;

export async function optimizeReceiptImageForOcr(
  buffer: Buffer,
  mimeType: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(buffer).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    const alreadySmall =
      w > 0 &&
      h > 0 &&
      w <= MAX_EDGE_PX &&
      h <= MAX_EDGE_PX &&
      (mimeType === "image/jpeg" || mimeType === "image/jpg");
    if (alreadySmall) {
      return { buffer, mimeType: "image/jpeg" };
    }
    const out = await sharp(buffer)
      .resize(MAX_EDGE_PX, MAX_EDGE_PX, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    return { buffer: Buffer.from(out), mimeType: "image/jpeg" };
  } catch (e) {
    console.warn("[receipt-image-prepare] resize skipped:", e);
    return { buffer, mimeType };
  }
}

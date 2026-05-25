/** Thrown when vision/OCR determines the upload is not a receipt or e-receipt. */
export class NotAReceiptError extends Error {
  readonly code = "not_a_receipt" as const;
  readonly documentType: string | null;

  constructor(
    message: string,
    documentType: string | null = null
  ) {
    super(message);
    this.name = "NotAReceiptError";
    this.documentType = documentType;
  }
}

export function isNotAReceiptError(err: unknown): err is NotAReceiptError {
  return err instanceof NotAReceiptError;
}

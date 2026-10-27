export type PortalSignatureField = {
  id: string;
  signerEmail: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type PortalSignatureInput = {
  fieldId: string;
  dni: string;
  typedName: string;
  signatureType: "typed" | "drawn";
  signatureImage: string;
};

// Do not move or resize a stored field: its coordinates are also used by GB Sign.
export function personalSignatureFields(fields: unknown, email: string): PortalSignatureField[] {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !Array.isArray(fields)) return [];
  return fields.filter((field): field is PortalSignatureField =>
    field && typeof field.id === "string" && field.id.length > 0 &&
    typeof field.signerEmail === "string" && field.signerEmail.trim().toLowerCase() === normalized &&
    Number.isInteger(field.page) && field.page > 0 &&
    [field.x, field.y, field.w, field.h].every(Number.isFinite) &&
    field.x >= 0 && field.y >= 0 && field.w > 0 && field.h > 0 &&
    field.x + field.w <= 1.000001 && field.y + field.h <= 1.000001,
  );
}

export function normalizeSigningDni(value: string): string {
  return value.replace(/[.\s-]/g, "");
}

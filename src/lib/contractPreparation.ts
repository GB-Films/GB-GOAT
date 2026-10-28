import type { PortalSignatureField } from './portalSigning';

export type ContractSigner = { providerId: string; name: string; email: string; dni?: string };
export function placeContractField(fields: PortalSignatureField[], signerEmail: string, page: number, x: number, y: number): PortalSignatureField[] {
  const existing = fields.find(field => field.signerEmail === signerEmail);
  const field = { id: existing?.id || `field_${crypto.randomUUID()}`, signerEmail, page,
    w: existing?.w || .32, h: existing?.h || .11, x: 0, y: 0 };
  field.x = Math.max(0, Math.min(1 - field.w, x)); field.y = Math.max(0, Math.min(1 - field.h, y));
  return [...fields.filter(current => current.signerEmail !== signerEmail), field];
}
export function contractPreparationIssue(signers: ContractSigner[], fields: PortalSignatureField[], pages: number): string {
  if (!signers.length) return 'Agregá al menos un proveedor como firmante.';
  if (signers.length > 10 || new Set(signers.map(signer => signer.email)).size !== signers.length) return 'Cada firmante debe tener una cuenta distinta (máximo 10).';
  if (fields.length !== signers.length || signers.some(signer => fields.filter(field => field.signerEmail === signer.email).length !== 1)) return 'Marcá en el PDF un recuadro para cada firmante.';
  if (fields.some(field => !Number.isInteger(field.page) || field.page < 1 || field.page > pages || ![field.x, field.y, field.w, field.h].every(Number.isFinite)
    || field.x < 0 || field.y < 0 || field.w < .1 || field.h < .045 || field.x + field.w > 1.000001 || field.y + field.h > 1.000001)) return 'Revisá la página y el tamaño de los recuadros.';
  if (fields.some((field, index) => fields.slice(index + 1).some(other => field.page === other.page && field.x < other.x + other.w && field.x + field.w > other.x && field.y < other.y + other.h && field.y + field.h > other.y))) return 'Separá los recuadros para que las firmas no se superpongan.';
  return '';
}

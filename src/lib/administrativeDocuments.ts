import { getFileExtension, sanitizeFileName } from './files';

export type AdministrativeDocumentScope = 'project' | 'client';
export type AdministrativeDocumentKind = 'agreement' | 'purchase_order' | 'invoice' | 'billing_guide' | 'supplier_guide' | 'tax_certificate' | 'other';

export interface AdministrativeDocument {
  id: string;
  scopeId: string;
  kind: AdministrativeDocumentKind;
  title: string;
  fileName: string;
  originalFileName: string;
  path: string;
  contentType: string;
  size: number;
  uploadedBy: string;
  createdAt?: unknown;
}

export const administrativeDocumentKinds: Record<AdministrativeDocumentKind, string> = {
  agreement: 'Contrato / acuerdo',
  purchase_order: 'Orden de compra',
  invoice: 'Factura emitida',
  billing_guide: 'Requisitos de facturación',
  supplier_guide: 'Instructivo de proveedores',
  tax_certificate: 'Certificado contable / fiscal',
  other: 'Otro documento',
};

const contentTypes: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export const MAX_ADMIN_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const administrativeDocumentPath = (scope: AdministrativeDocumentScope, id: string, documentId: string, name: string) => {
  const safeName = sanitizeFileName(name).slice(0, 120) || 'documento.pdf';
  return `administration/${scope === 'project' ? 'projects' : 'clients'}/${id}/${documentId}/${safeName}`;
};

export function validateAdministrativeDocument(file?: File | null): string {
  if (!file) return 'Seleccioná un archivo.';
  if (file.size === 0 || file.size > MAX_ADMIN_DOCUMENT_BYTES) return 'El archivo debe tener contenido y pesar como máximo 10 MB.';
  const extension = getFileExtension(file.name);
  if (!contentTypes[extension]) return 'Usá PDF, JPG, PNG, DOCX o XLSX.';
  if (file.type && file.type !== contentTypes[extension]) return 'El tipo del archivo no coincide con su extensión.';
  return '';
}

export const administrativeDocumentContentType = (file: File) => contentTypes[getFileExtension(file.name)];

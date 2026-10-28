import { matchesSmartSearch, normalizeSearch } from './smartSearch';

export const DOCUMENT_CATEGORIES = [
  { id: 'comprobantes', label: 'Comprobantes' },
  { id: 'contratos', label: 'Contratos' },
  { id: 'seguros', label: 'Seguros' },
] as const;
export type DocumentCategory = typeof DOCUMENT_CATEGORIES[number]['id'];
export type CatalogDocument = {
  id: string; family?: string; type?: string; subtype?: string; providerName: string;
  fileName: string; description: string; url: string; amount: number;
  uploadedAt?: any; paymentDate?: any; expirationDate?: string;
  sourceDocumentId?: string; providerId?: string; contentType?: string;
};

// Display mapping only: existing documents, paths and metadata stay in place.
export function documentCategory(document: { family?: string; type?: string; subtype?: string }): DocumentCategory {
  if (document.family === 'finanzas' || document.family === 'comprobantes') return 'comprobantes';
  if (document.family === 'seguros') return 'seguros';
  if (document.family === 'contratos') return 'contratos';
  const kind = normalizeSearch(`${document.type || ''} ${document.subtype || ''}`);
  if (/seguro|poliza|\bart\b|accidentes|responsabilidad civil/.test(kind)) return 'seguros';
  if (/factura|comprobante|pago|retencion/.test(kind)) return 'comprobantes';
  return 'contratos';
}

export function filterProjectDocuments<T extends { family?: string; type?: string; subtype?: string; providerName: string }>(documents: T[], category: DocumentCategory, providerSearch: string): T[] {
  return documents.filter(document => documentCategory(document) === category && matchesSmartSearch(providerSearch, document.providerName));
}

export const DOCUMENT_UPLOAD_TYPES: Record<DocumentCategory, string[]> = {
  comprobantes: ['Factura', 'Comprobante de pago', 'Retención', 'Otro comprobante'],
  contratos: ['Contrato proveedor', 'Contrato talento / crew', 'Prestación de servicios', 'Cesión de derechos', 'Release', 'Permiso de filmación', 'Autorización de locación', 'Condiciones de uso', 'Otro'],
  seguros: ['Seguro técnico / equipos', 'ART / accidentes personales', 'Responsabilidad civil', 'Seguro de locación', 'Póliza / certificado', 'Otro'],
};

export function signingDocumentMatchesProvider(document: { providerId?: string; signatures?: Array<{ email?: string }> }, search: string,
  providers: Array<{ id: string; name?: string; lastName?: string; fullName?: string; businessName?: string; companyName?: string; displayName?: string; email?: string; adminEmail?: string; portalAccessEmail?: string }>) {
  if (!search.trim()) return true;
  const signerEmails = new Set((document.signatures || []).map(signer => String(signer.email || '').trim().toLowerCase()));
  return providers.some(provider => (provider.id === document.providerId || [provider.email, provider.adminEmail, provider.portalAccessEmail].some(email => email && signerEmails.has(email.trim().toLowerCase())))
    && matchesSmartSearch(search, provider.displayName, provider.name, provider.lastName, provider.fullName, provider.businessName, provider.companyName));
}

import type { ProjectDocumentScope } from './providerFinance';
export type InvoiceReference = { id: string; issuerCuit?: string; issuerName?: string; number?: string };
export type InvoiceRecord = InvoiceReference & { kind: string; status: string; file?: { fileName?: string }; distinctExpenseCount?: number | null; allocations?: Array<{ projectId: string; collectionName: string; itemId: string }> };
const digits = (value: unknown) => String(value || '').replace(/\D/g, '');
export function isThirdPartyInvoice(invoice: { issuerCuit?: string }, providerCuit?: string) {
  const issuer = digits(invoice.issuerCuit), provider = digits(providerCuit);
  return /^\d{11}$/.test(issuer) && /^\d{11}$/.test(provider) && issuer !== provider;
}
export function sharedInvoiceAction(record: InvoiceRecord | undefined, scope: ProjectDocumentScope | null) {
  if (!record || record.kind !== 'invoice' || record.status !== 'active' || !scope || !record.allocations?.some(row =>
    row.projectId === scope.projectId && row.collectionName === scope.collectionName && row.itemId === scope.itemId)) return 'unavailable';
  if (!record.file?.fileName) return 'missing-file';
  // This count comes from ALL native allocations, before project filtering.
  // Never substitute the number of records or scoped allocations for it.
  if (!Number.isSafeInteger(record.distinctExpenseCount) || record.distinctExpenseCount! < 1) return 'unknown';
  return record.distinctExpenseCount === 1 ? 'file' : 'profile';
}
export function sharedInvoiceReferences(item: { sharedInvoices?: InvoiceReference[] }) {
  return [...new Map((Array.isArray(item.sharedInvoices) ? item.sharedInvoices : []).filter(row => row && typeof row.id === 'string').map(row => [row.id, row])).values()];
}
export function projectInvoiceRelationsKey(items: any[]) {
  // Cache invalidation only: this local graph is never the invoice's total.
  return JSON.stringify(items.flatMap(item => sharedInvoiceReferences(item).map(row =>
    [item.__invoiceCollectionName, item.id, row.id])).map(row => JSON.stringify(row)).sort());
}

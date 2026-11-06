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
export function expenseLinkedRecordIds(item: any): string[] {
  return [...new Set<string>([...sharedInvoiceReferences(item).map(row => row.id),
    ...(Array.isArray(item.sharedReceipts) ? item.sharedReceipts.map((row: any) => row?.id) : []),
    ...(Array.isArray(item.sharedPaymentIds) ? item.sharedPaymentIds : []),
  ].filter((value): value is string => typeof value === 'string' && /^[\w-]{1,160}$/.test(value)))];
}
export function hasLinkedExpenseFile(item: any, records: Map<string, InvoiceRecord>, scope: ProjectDocumentScope | null) {
  if (!scope) return false;
  return expenseLinkedRecordIds(item).some(id => {
    const record = records.get(id);
    const referenced = record?.kind === 'payment' ? Array.isArray(item.sharedPaymentIds) && item.sharedPaymentIds.includes(id)
      : record?.kind === 'other' && Array.isArray(item.sharedReceipts) && item.sharedReceipts.some((row: any) => row?.id === id);
    return referenced && record?.status === 'active' && !!record.file?.fileName
      && record.allocations?.some(row => row.projectId === scope.projectId && row.collectionName === scope.collectionName && row.itemId === scope.itemId);
  });
}
export function projectInvoiceRelationsKey(items: any[]) {
  // Cache invalidation for linked files only; never an invoice's global total.
  return JSON.stringify(items.flatMap(item => expenseLinkedRecordIds(item).map(id =>
    [item.__invoiceCollectionName, item.id, id])).map(row => JSON.stringify(row)).sort());
}

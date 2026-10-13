import { getExpenseInvoices, type ExpenseInvoiceDocument } from './invoices';

export function uniqueProviderDocuments(documents: ExpenseInvoiceDocument[]) {
  const seen = new Set<string>();
  return documents.filter(document => {
    if (!document?.url) return false;
    const key = document.path || document.url || document.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getProviderExpenseDocuments(item: any) {
  return {
    invoiceDocuments: uniqueProviderDocuments(getExpenseInvoices(item)),
    otherReceiptDocuments: uniqueProviderDocuments(Array.isArray(item.otherReceipts) ? item.otherReceipts : []),
    paymentReceiptDocuments: uniqueProviderDocuments((Array.isArray(item.paymentHistory) ? item.paymentHistory : [])
      .flatMap((payment: any) => [payment.receipt, ...(Array.isArray(payment.reimbursements) ? payment.reimbursements.map((entry: any) => entry.receipt) : [])])),
  };
}

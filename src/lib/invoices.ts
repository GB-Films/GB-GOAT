export type ExpenseInvoiceDocument = {
  id?: string;
  fileName?: string;
  originalFileName?: string;
  url?: string;
  path?: string;
  contentType?: string;
  size?: number;
  uploadedAt?: any;
  uploadedBy?: string;
};

export const getInvoiceDocumentKey = (invoice?: ExpenseInvoiceDocument | null) => (
  invoice?.id || invoice?.path || invoice?.url || invoice?.fileName || ''
);

export const getExpenseInvoices = (item?: any | null): ExpenseInvoiceDocument[] => {
  const storedInvoices = Array.isArray(item?.invoices)
    ? item.invoices.filter((invoice: any) => invoice && invoice.url)
    : [];
  const legacyInvoice = item?.invoice?.url ? item.invoice : null;
  const candidates = legacyInvoice ? [legacyInvoice, ...storedInvoices] : storedInvoices;
  const seen = new Set<string>();

  return candidates.filter((invoice: ExpenseInvoiceDocument) => {
    const key = getInvoiceDocumentKey(invoice);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const getPrimaryExpenseInvoice = (item?: any | null) => getExpenseInvoices(item)[0] || null;

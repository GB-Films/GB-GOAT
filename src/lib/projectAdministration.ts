export type DocumentStatus = 'pending' | 'confirmed' | 'not_required';
export type BillingStatus = 'pending' | 'ready' | 'not_required';
export type BillingChannel = '' | 'email' | 'portal' | 'both';
export type PaymentTermBasis = '' | 'invoice' | 'submission' | 'delivery' | 'fixed';
export type Currency = 'ARS' | 'USD';

export interface CustomerInvoice {
  id: string;
  number: string;
  issueDate: string;
  sentDate: string;
  portalDate: string;
  amount: number;
  currency: Currency;
  dueDate: string;
  documentRef: string;
  documentPath?: string;
  ctRef: string;
}

export interface CustomerCollection {
  id: string;
  invoiceId: string;
  date: string;
  appliedAmount: number;
  netReceived: number;
  withholding: number;
  reference: string;
  documentRef: string;
}

export interface ProjectAdministrationRecord {
  schemaVersion: 1;
  projectId: string;
  clientLegalName: string;
  issuerEntity: string;
  agreementStatus: DocumentStatus;
  agreementRef: string;
  agreementFilePath?: string;
  agreedAmount: number | null;
  agreedCurrency: '' | Currency;
  orderStatus: DocumentStatus;
  orderNumber: string;
  orderRef: string;
  orderFilePath?: string;
  billingStatus: BillingStatus;
  billingRequirement: string;
  billingChannel: BillingChannel;
  portalRef: string;
  paymentTermDays: number | null;
  paymentTermBasis: PaymentTermBasis;
  paymentTermSource: string;
  notes: string;
  invoices: CustomerInvoice[];
  collections: CustomerCollection[];
  updatedBy: string;
  revision: number;
}

export type AdministrationAction = 'untracked' | 'agreement' | 'order' | 'billing_review' | 'billing' | 'send' | 'terms' | 'overdue' | 'upcoming' | 'collection' | 'complete';

export const emptyProjectAdministration = (projectId: string): ProjectAdministrationRecord => ({
  schemaVersion: 1,
  projectId,
  clientLegalName: '',
  issuerEntity: '',
  agreementStatus: 'pending',
  agreementRef: '',
  agreementFilePath: '',
  agreedAmount: null,
  agreedCurrency: '',
  orderStatus: 'pending',
  orderNumber: '',
  orderRef: '',
  orderFilePath: '',
  billingStatus: 'pending',
  billingRequirement: '',
  billingChannel: '',
  portalRef: '',
  paymentTermDays: null,
  paymentTermBasis: '',
  paymentTermSource: '',
  notes: '',
  invoices: [],
  collections: [],
  updatedBy: '',
  revision: 0,
});

export const normalizeProjectAdministration = (projectId: string, source?: Partial<ProjectAdministrationRecord>): ProjectAdministrationRecord => ({
  ...emptyProjectAdministration(projectId),
  ...source,
  projectId,
  schemaVersion: 1,
  invoices: Array.isArray(source?.invoices) ? source.invoices : [],
  collections: Array.isArray(source?.collections) ? source.collections : [],
});

export const amountAppliedToInvoice = (record: ProjectAdministrationRecord, invoiceId: string) =>
  record.collections.filter(item => item.invoiceId === invoiceId).reduce((sum, item) => sum + Number(item.appliedAmount || 0), 0);

export const invoiceBalance = (record: ProjectAdministrationRecord, invoice: CustomerInvoice) =>
  Math.max(0, Math.round((Number(invoice.amount || 0) - amountAppliedToInvoice(record, invoice.id)) * 100) / 100);

export function unbilledAmount(record: ProjectAdministrationRecord): number | null {
  if (record.agreedAmount === null || !record.agreedCurrency) return null;
  if (record.invoices.some(invoice => invoice.currency !== record.agreedCurrency)) return null;
  return Math.max(0, Math.round((record.agreedAmount - record.invoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0)) * 100) / 100);
}

const validDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export const localDateKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function resolvedInvoiceDueDate(record: ProjectAdministrationRecord, invoice: CustomerInvoice): string {
  if (validDate(invoice.dueDate)) return invoice.dueDate;
  if (record.paymentTermDays === null || !record.paymentTermSource.trim()) return '';
  const base = record.paymentTermBasis === 'invoice' ? invoice.issueDate
    : record.paymentTermBasis === 'submission' ? [invoice.portalDate, invoice.sentDate].filter(validDate).sort().at(-1) || '' : '';
  if (!validDate(base)) return '';
  const due = new Date(`${base}T12:00:00Z`);
  due.setUTCDate(due.getUTCDate() + record.paymentTermDays);
  return due.toISOString().slice(0, 10);
}

export function administrationAction(record: ProjectAdministrationRecord | null | undefined, today: string): AdministrationAction {
  if (!record) return 'untracked';
  if (record.agreementStatus === 'pending') return 'agreement';
  if (record.orderStatus === 'pending') return 'order';
  if (record.billingStatus === 'ready' && record.invoices.length === 0) return 'billing';
  const open = record.invoices.filter(invoice => invoiceBalance(record, invoice) > 0.009);
  if (open.some(invoice => (
    record.billingChannel === 'both' ? !invoice.sentDate || !invoice.portalDate
      : record.billingChannel === 'email' ? !invoice.sentDate
        : record.billingChannel === 'portal' ? !invoice.portalDate
          : !invoice.sentDate && !invoice.portalDate
  ))) return 'send';
  if (open.some(invoice => !resolvedInvoiceDueDate(record, invoice))) return 'terms';
  if (open.some(invoice => resolvedInvoiceDueDate(record, invoice) < today)) return 'overdue';
  const soon = new Date(`${today}T12:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + 7);
  if (open.some(invoice => resolvedInvoiceDueDate(record, invoice) <= soon.toISOString().slice(0, 10))) return 'upcoming';
  if (record.billingStatus === 'ready' && (unbilledAmount(record) ?? 0) > 0.009) return 'billing';
  if (open.length > 0) return 'collection';
  if (record.billingStatus === 'pending' || (record.agreementStatus === 'confirmed' && unbilledAmount(record) === null)) return 'billing_review';
  return 'complete';
}

export const administrationActionLabel: Record<AdministrationAction, string> = {
  untracked: 'Sin seguimiento',
  agreement: 'Confirmar acuerdo',
  order: 'Confirmar OC',
  billing_review: 'Verificar facturación',
  billing: 'Por facturar',
  send: 'Enviar o cargar factura',
  terms: 'Plazo sin confirmar',
  overdue: 'Cobro vencido',
  upcoming: 'Cobro próximo',
  collection: 'Cobro pendiente',
  complete: 'Al día',
};

export function validateAdministration(record: ProjectAdministrationRecord): string | null {
  if ((record.billingStatus === 'ready' || record.invoices.length > 0) && !record.clientLegalName.trim()) return 'Indicá la razón social del cliente antes de facturar.';
  if ((record.billingStatus === 'ready' || record.invoices.length > 0) && !record.issuerEntity.trim()) return 'Indicá qué empresa emite la factura.';
  if (record.agreementStatus === 'confirmed' && !record.agreementRef.trim() && !record.agreementFilePath?.trim()) return 'Agregá la referencia o el archivo del acuerdo aprobado.';
  if (record.agreedAmount !== null && (!Number.isFinite(record.agreedAmount) || record.agreedAmount <= 0 || !record.agreedCurrency)) return 'Indicá un importe aprobado positivo y su moneda.';
  if (record.agreedCurrency && record.agreedAmount === null) return 'Indicá el importe aprobado.';
  if (record.orderStatus === 'confirmed' && !record.orderNumber.trim()) return 'Agregá el número de OC.';
  if (record.paymentTermDays !== null && (!Number.isInteger(record.paymentTermDays) || record.paymentTermDays < 0 || record.paymentTermDays > 3650)) return 'El plazo de pago debe ser un número entero de días.';
  if (record.paymentTermDays !== null && (!record.paymentTermBasis || !record.paymentTermSource.trim())) return 'Indicá desde cuándo corre el plazo y su fuente.';
  for (const invoice of record.invoices) {
    if (!invoice.number.trim() || !validDate(invoice.issueDate) || !(invoice.amount > 0)) return 'Cada factura necesita número, fecha de emisión e importe positivo.';
    if (!invoice.documentRef.trim() && !invoice.documentPath?.trim() && !invoice.ctRef.trim()) return `Agregá el comprobante o la referencia de CT de ${invoice.number}.`;
    if (invoice.dueDate && !validDate(invoice.dueDate)) return `La fecha de vencimiento de ${invoice.number} no es válida.`;
    if (invoice.sentDate && !validDate(invoice.sentDate)) return `La fecha de envío de ${invoice.number} no es válida.`;
    if (invoice.portalDate && !validDate(invoice.portalDate)) return `La fecha de portal de ${invoice.number} no es válida.`;
  }
  for (const item of record.collections) {
    const invoice = record.invoices.find(candidate => candidate.id === item.invoiceId);
    if (!invoice || !validDate(item.date) || !(item.appliedAmount > 0)) return 'Cada cobro necesita factura, fecha e importe aplicado.';
    if (!item.reference.trim() && !item.documentRef.trim()) return 'Cada cobro necesita una referencia bancaria, de CT o un comprobante.';
    if (item.netReceived < 0 || item.withholding < 0 || Math.abs(item.appliedAmount - item.netReceived - item.withholding) > 0.02) return 'El importe aplicado debe coincidir con lo recibido más las retenciones.';
    if (amountAppliedToInvoice(record, invoice.id) > invoice.amount + 0.01) return `Los cobros superan el importe de ${invoice.number}.`;
  }
  return null;
}

import { hasActiveExpensePayments, hasRecordedPayment } from './expenseEdits';
export function canDeleteUnpaidAreaExpense(row: any, isAdmin: boolean) {
  if (!row || hasActiveExpensePayments({ ...row, paymentHistory: row.paymentHistory ?? [] })
    || [row.sharedPaymentIds, row.sharedPaymentRecords].some(value => value != null && (!Array.isArray(value) || value.length > 0))) return false;
  return isAdmin || !hasRecordedPayment(row) && (row.thirdPartyPayoutRequired === undefined || row.thirdPartyPayoutRequired === false) && !(row.sharedInvoices?.length || row.sharedReceipts?.length);
}
export type UnpaidExpenseDeletionPreview = { fingerprint: string; label: string; area: string; total: number; invoiceCount: number };
export function unpaidExpenseDeletionConfirmation(source: Omit<UnpaidExpenseDeletionPreview, 'fingerprint'>) {
  const invoices = source.invoiceCount > 0
    ? `\n\nSe eliminarán de esta fila ${source.invoiceCount === 1 ? 'la factura cargada' : `las ${source.invoiceCount} facturas cargadas`}. Los originales compartidos con otras filas se conservarán en ellas.` : '';
  return `¿Eliminar "${source.label}" de Áreas?\n\nÁrea: ${source.area}\nTotal: $${source.total.toLocaleString('es-AR')}${invoices}\n\nSe eliminará la fila y sus documentos adjuntos. Esta acción no se puede deshacer.`;
}

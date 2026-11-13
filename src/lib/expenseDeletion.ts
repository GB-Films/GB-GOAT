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

export async function deleteUnpaidExpenseWithConfirmation({ projectId, itemId, request, confirm, isCurrent, newId = () => crypto.randomUUID() }: {
  projectId: string; itemId: string; request: (data: Record<string, unknown>) => Promise<any>;
  confirm: (message: string) => boolean; isCurrent: () => boolean; newId?: () => string;
}) {
  const scope = { projectId, itemId };
  const preview = await request({ action: 'previewDeleteUnpaidAreaExpense', ...scope }) as UnpaidExpenseDeletionPreview;
  if (!isCurrent() || !confirm(unpaidExpenseDeletionConfirmation(preview))) return false;
  await request({ action: 'deleteUnpaidAreaExpense', ...scope, operationId: newId(), expectedFingerprint: preview.fingerprint });
  return isCurrent();
}

export function unpaidExpenseDeletionErrorMessage(error: unknown) {
  const e = error as { code?: string; message?: string };
  if (e?.code === 'functions/unauthenticated') return 'Tu sesión venció. Volvé a ingresar y a intentar eliminar la fila.';
  if (e?.code === 'functions/permission-denied' || e?.code === 'permission-denied') return 'No tenés permiso para eliminar esta fila o sus documentos. Pedile a un administrador del proyecto que lo haga.';
  if (e?.code === 'functions/failed-precondition' && e.message) return e.message;
  return 'No se pudo confirmar la eliminación. Revisá la conexión y si la fila sigue apareciendo antes de volver a intentar.';
}

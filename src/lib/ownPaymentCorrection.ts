import { providerTimestamp } from './providerOrdering';
export function paymentCorrectionSnapshot(payment: any) {
  return { id: payment.id || '', createdBy: payment.createdBy || '', createdByEmail: payment.createdByEmail || '',
    amount: payment.amount, detail: payment.detail || '', date: providerTimestamp(payment.date) === null ? null : Math.floor(providerTimestamp(payment.date)!), receiptPath: payment.receipt?.path || '',
    cashMovementId: payment.cashMovementId || '', cashAccount: payment.cashAccount || '', paidByEmail: payment.paidByEmail || '', method: payment.method || '' };
}

export const canHaveCashReceipt = (payment: any) => Boolean(payment?.id && payment?.method === 'caja_efectivo'
  && ['general', 'personal'].includes(payment.cashAccount) && payment.cashMovementId && payment.amount > 0 && !payment.sharedRecordId);
export const cashReceiptStatus = (status: string) => ({ preparing: 'Preparando solicitud', requested: 'Pendiente de firma', signed: 'Recibo firmado', cancelled: 'Anulado', replaced: 'Pago modificado · antecedente' } as Record<string, string>)[status] || status;

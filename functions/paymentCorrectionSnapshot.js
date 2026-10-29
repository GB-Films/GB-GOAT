const time = value => value?.toMillis ? value.toMillis() : typeof value?.seconds === 'number' ? value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6) : new Date(value).getTime();
function paymentCorrectionSnapshot(payment) {
  return { id: payment.id || '', createdBy: payment.createdBy || '', createdByEmail: payment.createdByEmail || '',
    amount: payment.amount, detail: payment.detail || '', date: Number.isFinite(time(payment.date)) ? Math.floor(time(payment.date)) : null, receiptPath: payment.receipt?.path || '',
    cashMovementId: payment.cashMovementId || '', cashAccount: payment.cashAccount || '', paidByEmail: payment.paidByEmail || '', method: payment.method || '' };
}
module.exports = { paymentCorrectionSnapshot };

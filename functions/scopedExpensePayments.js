const { email } = require('./providerPortalModel');

const hasEntries = value => value != null && (!Array.isArray(value) || value.length > 0);
const hasSharedPayments = row => hasEntries(row.sharedPaymentIds) || hasEntries(row.sharedPaymentRecords);
const hasPayments = row => row.paid === true || hasEntries(row.paymentHistory);

function canEditScopedExpensePayments(row, actor) {
  if (hasSharedPayments(row)) return false;
  const history = row.paymentHistory;
  if (!Array.isArray(history)) return history == null && row.paid !== true && row.paymentLocked !== true;
  if (!history.length) return row.paid !== true;
  return history.every(p => p?.createdBy === actor.uid && !p.sharedRecordId
    && (!p.createdByEmail || email(p.createdByEmail) === actor.email));
}

module.exports = { hasSharedPayments, hasPayments, canEditScopedExpensePayments };

const { HttpsError } = require('firebase-functions/v2/https');
const { createHash } = require('node:crypto');
const { projectFinanceAccess, linkedAllocation } = require('./projectFinanceAccess');
const deny = message => { throw new HttpsError('permission-denied', message); };
const list = value => Array.isArray(value) ? value : [];

function createRemoveExpenseInvoiceFile({ db, timestamp }) {
  return async (actor, input) => {
    if (Object.keys(input).some(key => !['action', 'projectId', 'collectionName', 'itemId', 'recordId'].includes(key))
      || !['areaExpenses', 'budgetItems'].includes(input.collectionName)
      || ![input.projectId, input.itemId, input.recordId].every(value => typeof value === 'string' && /^[\w-]{1,160}$/.test(value))) {
      throw new HttpsError('invalid-argument', 'Elegí una factura de este gasto.');
    }
    const { projectId, collectionName, itemId, recordId } = input;
    const expenseRef = db.doc(`projects/${projectId}/${collectionName}/${itemId}`);
    const recordRef = db.doc(`providerFinancialRecords/${recordId}`);
    const auditId = 'invoice-file-removed-' + createHash('sha256').update([projectId, collectionName, itemId, recordId].join('/')).digest('hex');
    return db.runTransaction(async transaction => {
      const access = await projectFinanceAccess({ db, transaction, actor, projectId });
      if (!access.admin) deny('Sólo un administrador del proyecto puede quitar esta factura.');
      const [expenseSnapshot, recordSnapshot] = await transaction.getAll(expenseRef, recordRef);
      const expense = expenseSnapshot.data(), record = { ...recordSnapshot.data(), id: recordId };
      const references = list(expense?.sharedInvoices);
      const reference = references.find(row => row?.id === recordId);
      if (!reference || record.kind !== 'invoice' || record.status !== 'active' || !record.file
        || !linkedAllocation(record, projectId, itemId, collectionName, expense)) deny('La factura ya no está vinculada a este gasto. Actualizá la página.');
      if (reference.fileHidden === true) return { sharedInvoices: references, repeated: true };
      const next = references.map(row => row?.id === recordId ? { ...row, fileHidden: true } : row);
      const now = timestamp();
      transaction.update(expenseRef, { sharedInvoices: next, updatedAt: now });
      transaction.create(db.doc(`projects/${projectId}/activityLog/${auditId}`), {
        action: 'expense_invoice_file_removed', collectionName, itemId, recordId,
        before: { sharedInvoices: references }, after: { sharedInvoices: next },
        createdBy: actor.uid, createdByEmail: actor.email, createdAt: now,
      });
      // The original, allocations and payments remain intact; this removes the
      // file from this expense's document controls, never another expense's file.
      return { sharedInvoices: next, repeated: false };
    });
  };
}
module.exports = { createRemoveExpenseInvoiceFile };

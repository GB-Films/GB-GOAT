const { HttpsError } = require('firebase-functions/v2/https');
const { projectFinanceAccess, linkedAllocation } = require('./projectFinanceAccess');
const { hash, expenseInvoices } = require('./providerPortalModel');
const { activeRecordAllocations, allocationKey } = require('./providerFinanceAllocations');
const list = value => Array.isArray(value) ? value : [];
const fail = (message, code = 'failed-precondition') => { throw new HttpsError(code, message); };
function hasPayments(row) {
  return row.paid === true || row.paymentHistory != null && (!Array.isArray(row.paymentHistory) || row.paymentHistory.length > 0)
    || ['sharedPaymentIds', 'sharedPaymentRecords'].some(field => row[field] != null && (!Array.isArray(row[field]) || row[field].length > 0));
}
function canDelete(access, row) {
  const c = access.collaborator || {}, storedSubcategory = String(row.subcategory || '').trim();
  const subcategory = storedSubcategory === 'Sin subcategoria' ? '' : storedSubcategory, key = `${row.area}||${subcategory}`;
  return access.admin || row.paymentLocked !== true && (row.thirdPartyPayoutRequired === undefined || row.thirdPartyPayoutRequired === false) && !list(row.sharedInvoices).length && !list(row.sharedReceipts).length
    && c.canEditBudgetAreas === true && list(c.allowedTabs).includes('areas') && !list(c.excludedSubcategories).includes(key)
    && (list(c.allowedCategories).includes(row.area) || !!subcategory && list(c.allowedSubcategories).includes(key));
}
function createDeleteUnpaidAreaExpense({ db, timestamp }) {
  return async (actor, input) => {
    if (Object.keys(input).some(key => !['action', 'projectId', 'itemId', 'operationId', 'expectedFingerprint'].includes(key))
      || !['previewDeleteUnpaidAreaExpense', 'deleteUnpaidAreaExpense'].includes(input.action)
      || ![input.projectId, input.itemId].every(v => typeof v === 'string' && /^[\w-]{1,160}$/.test(v))) fail('Elegí una fila de Áreas.', 'invalid-argument');
    const deleting = input.action === 'deleteUnpaidAreaExpense';
    if (deleting && (!/^[a-f0-9-]{36}$/i.test(input.operationId || '') || !/^[a-f0-9]{64}$/.test(input.expectedFingerprint || ''))) fail('Volvé a confirmar la eliminación de la fila.', 'invalid-argument');
    const scope = { projectId: input.projectId, collectionName: 'areaExpenses', itemId: input.itemId }, key = allocationKey(scope);
    const expenseRef = db.doc(`projects/${scope.projectId}/areaExpenses/${scope.itemId}`);
    const auditRef = deleting ? db.doc(`projects/${scope.projectId}/activityLog/unpaid-expense-deleted-${input.operationId}`) : null;
    return db.runTransaction(async tx => {
      const access = await projectFinanceAccess({ db, transaction: tx, actor, projectId: scope.projectId });
      const prior = auditRef ? (await tx.get(auditRef)).data() : null;
      if (prior) {
        if (prior.action !== 'unpaid_area_expense_deleted' || prior.itemId !== scope.itemId || prior.deletedBy !== actor.uid
          || prior.deletedByEmail !== actor.email || prior.confirmedFingerprint !== input.expectedFingerprint) fail('Este intento no corresponde a esta fila.');
        if (!canDelete(access, prior.previousDocument)) fail('Ya no tenés permiso para esta fila.', 'permission-denied');
        return { deleted: true, repeated: true };
      }
      const row = (await tx.get(expenseRef)).data();
      if (!row) fail('La fila ya fue eliminada. Actualizá la página.');
      if (!canDelete(access, row)) fail('No tenés permiso para eliminar esta fila o sus documentos.', 'permission-denied');
      if (!list(access.project.activeAreas).includes(row.area)) fail('La gestión de esta fila cambió. Actualizá la página.');
      if (hasPayments(row)) fail('No se puede eliminar la fila: tiene pagos registrados. Revisá Gestión de pagos.');
      if (['sharedInvoices', 'sharedReceipts'].some(field => row[field] != null && !Array.isArray(row[field]))) fail('Administración debe revisar los documentos vinculados antes de eliminar la fila.');
      const cash = await tx.get(db.collection(`projects/${scope.projectId}/cashMovements`).where('itemId', '==', scope.itemId).limit(501));
      if (cash.size > 500) fail('La fila requiere una revisión de sus movimientos de caja.');
      if (cash.docs.some(s => ['pago', 'reintegro'].includes(s.data().type) && (!s.data().collectionName || s.data().collectionName === 'areaExpenses'))) fail('No se puede eliminar la fila: tiene un pago o reintegro vinculado en Cajas.');
      const recordIds = [...new Set([...list(row.sharedInvoices), ...list(row.sharedReceipts)].map(ref => ref?.id))];
      if (recordIds.length > 300 || recordIds.some(v => typeof v !== 'string' || !/^[\w-]{1,160}$/.test(v))) fail('Administración debe revisar los documentos vinculados antes de eliminar la fila.');
      const records = recordIds.length ? await tx.getAll(...recordIds.map(id => db.doc(`providerFinancialRecords/${id}`))) : [];
      for (const snapshot of records) {
        const record = { ...snapshot.data(), id: snapshot.id };
        if (!snapshot.exists || record.status !== 'active' || !['invoice', 'other'].includes(record.kind) || !linkedAllocation(record, scope.projectId, scope.itemId, scope.collectionName, row)) fail('Un documento vinculado cambió. Actualizá la fila antes de eliminarla.');
        if (Object.values(record.settlements || {}).flat().some(allocation => allocationKey(allocation) === key)) fail('No se puede eliminar: hay pagos aplicados a una factura de esta fila.');
      }
      const invoiceCount = expenseInvoices(row).length + new Set(list(row.sharedInvoices).filter(ref => ref.fileHidden !== true).map(ref => ref.id)).size;
      const fingerprint = hash({ row, records: records.map(s => ({ id: s.id, ...s.data() })) });
      if (!deleting) return { fingerprint, invoiceCount, label: row.description || row.providerName || 'este gasto', area: row.area, total: Number(row.total) || 0 };
      if (fingerprint !== input.expectedFingerprint) fail('La fila o sus facturas cambiaron. Revisalas y confirmá la eliminación nuevamente.');
      const indexRef = db.doc(`providerFinanceProjectIndex/${scope.projectId}`);
      const index = records.length ? (await tx.get(indexRef)).data() : null;
      const indexRecords = { ...(index?.records || {}) }, now = timestamp();
      for (const snapshot of records) {
        const record = snapshot.data(), detachedExpenseKeys = [...new Set([...list(record.detachedExpenseKeys), key])];
        const remaining = activeRecordAllocations({ ...record, detachedExpenseKeys }).filter(a => a.projectId === scope.projectId);
        if (remaining.length) Object.defineProperty(indexRecords, snapshot.id, { value: remaining.map(a => ({ area: a.area, collectionName: a.collectionName })), enumerable: true, configurable: true, writable: true });
        else delete indexRecords[snapshot.id];
        tx.update(snapshot.ref, { detachedExpenseKeys, updatedAt: now });
      }
      if (records.length) {
        tx.set(indexRef, { ...(index || {}), records: indexRecords,
          managedAreas: [...new Set(Object.values(indexRecords).flat().filter(a => a.collectionName === 'areaExpenses').map(a => a.area))],
          budgetAreas: [...new Set(Object.values(indexRecords).flat().filter(a => a.collectionName === 'budgetItems').map(a => a.area))], updatedAt: now });
        tx.set(db.doc(`providerFinanceProviderIndex/${row.providerId}`), { updatedAt: now }, { merge: true });
      }
      tx.create(auditRef, { action: 'unpaid_area_expense_deleted', ...scope, invoiceCount, previousDocument: row,
        detachedRecordIds: recordIds, confirmedFingerprint: fingerprint, deletedBy: actor.uid, deletedByEmail: actor.email, createdAt: now });
      tx.delete(expenseRef);
      return { deleted: true, repeated: false };
    });
  };
}
module.exports = { createDeleteUnpaidAreaExpense, hasPayments, canDelete };

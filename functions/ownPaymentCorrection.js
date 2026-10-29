const { HttpsError } = require('firebase-functions/v2/https');
const { hash, id, list } = require('./providerPortalModel');
const { projectFinanceAccess } = require('./projectFinanceAccess');
const { availablePersonalCents } = require('./cashSubdelivery');
const { isInternalBudgetEstimate } = require('./internalBudgetEstimate');
const fail = message => { throw new HttpsError('failed-precondition', message); };
const cents = value => Math.round(Number(value) * 100);
const { paymentCorrectionSnapshot } = require('./paymentCorrectionSnapshot');
const clientValue = value => value?.toDate ? value.toDate().toISOString() : value instanceof Date ? value.toISOString()
  : Array.isArray(value) ? value.map(clientValue) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clientValue(entry)])) : value;
function createOwnPaymentCorrection({ db, timestamp, verifyPaymentReceipt }) {
  return async (actor, input) => {
    const projectId = id(input.projectId), itemId = id(input.itemId), paymentId = id(input.paymentId), attemptId = id(input.attemptId);
    if (input.collectionName !== 'areaExpenses') fail('La corrección requiere permisos sobre el área del gasto.');
    if (!input.expected || typeof input.expected !== 'object' || Array.isArray(input.expected)) fail('Falta la versión del pago que abriste.');
    const expectedKeys = ['id', 'createdBy', 'createdByEmail', 'amount', 'detail', 'date', 'receiptPath', 'cashMovementId', 'cashAccount', 'paidByEmail', 'method'];
    if (Object.keys(input.expected).length !== expectedKeys.length || Object.entries(input.expected).some(([key, value]) => !expectedKeys.includes(key)
      || (key === 'amount' || key === 'date' ? value !== null && (typeof value !== 'number' || !Number.isFinite(value)) : typeof value !== 'string' || value.length > 2000))) fail('Versión de pago inválida.');
    if (typeof input.amount !== 'number' || !Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 1e10
      || Math.abs(input.amount * 100 - cents(input.amount)) > 0.0001) fail('Importe inválido.');
    const date = new Date(`${input.date}T12:00:00Z`);
    if (typeof input.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isFinite(date.getTime())
      || date.toISOString().slice(0, 10) !== input.date) fail('Fecha inválida.');
    if (typeof input.detail !== 'string' || input.detail.length > 2000) fail('Detalle inválido.');
    const root = db.doc(`projects/${projectId}`), expenseRef = root.collection('areaExpenses').doc(itemId);
    const auditRef = root.collection('activityLog').doc(`own-payment-${attemptId}`);
    const fingerprint = hash({ actor, projectId, itemId, paymentId, expected: input.expected, amount: input.amount, date: input.date, detail: input.detail,
      receipt: input.receipt ? { path: input.receipt.path, url: input.receipt.url } : null });
    return db.runTransaction(async tx => {
      const access = await projectFinanceAccess({ db, transaction: tx, actor, projectId });
      const [expenseSnap, priorAudit] = await Promise.all([tx.get(expenseRef), tx.get(auditRef)]);
      const expense = expenseSnap.data(), collaborator = access.collaborator;
      if (!expense || isInternalBudgetEstimate(expense) || (!access.admin && !(collaborator?.canEditBudgetAreas === true
        && list(collaborator.allowedTabs).includes('areas') && (list(collaborator.allowedCategories).includes(expense.area)
          || !!expense.subcategory && list(collaborator.allowedSubcategories).includes(`${expense.area}||${expense.subcategory}`)))))
        throw new HttpsError('permission-denied', 'No podés corregir pagos de esta área.');
      const history = list(expense.paymentHistory), index = history.findIndex(payment => payment.id === paymentId), payment = history[index];
      if (!payment || payment.sharedRecordId || payment.createdBy !== actor.uid || payment.createdByEmail !== actor.email)
        throw new HttpsError('permission-denied', 'Sólo podés corregir pagos que cargaste vos.');
      if (priorAudit.exists) {
        if (priorAudit.data().fingerprint !== fingerprint) fail('El intento ya corresponde a otra corrección.');
        return { paymentHistory: clientValue(history), paid: expense.paid, repeated: true };
      }
      if (hash(paymentCorrectionSnapshot(payment)) !== hash(input.expected)) fail('El pago cambió. Volvé a abrirlo antes de corregirlo.');
      if (history.some(row => typeof row.amount !== 'number' || !Number.isFinite(row.amount) || row.amount <= 0)) fail('Revisá el historial antes de corregirlo.');
      const totalPaid = history.reduce((sum, row, position) => sum + (position === index ? cents(input.amount) : cents(row.amount)), 0);
      if (!Number.isFinite(Number(expense.total)) || totalPaid > cents(expense.total)) fail('El pago supera el saldo disponible del gasto.');
      const reimbursed = list(payment.reimbursements).reduce((sum, row) => sum + cents(row.amount), 0);
      if (cents(input.amount) < Math.max(reimbursed, cents(payment.reimbursedAmount || 0))) fail('El pago no puede quedar por debajo de sus reintegros.');
      const movementRef = payment.cashMovementId ? root.collection('cashMovements').doc(id(payment.cashMovementId)) : null;
      if (Boolean(movementRef) !== (payment.method === 'caja_efectivo')) fail('El vínculo con la caja cambió.');
      const movement = movementRef ? (await tx.get(movementRef)).data() : null;
      if (movementRef && (!movement || movement.type !== 'pago' || movement.sharedRecordId || movement.subdelivery
        || movement.collectionName !== 'areaExpenses' || movement.itemId !== itemId || movement.paymentId !== paymentId
        || movement.cashAccount !== payment.cashAccount || movement.fromUserEmail !== payment.paidByEmail
        || cents(movement.amount) !== cents(payment.amount))) fail('El vínculo con la caja cambió.');
      if (movement && movement.cashAccount !== 'general') {
        if (movement.fromUserEmail !== actor.email) throw new HttpsError('permission-denied', 'No podés modificar la caja de otra persona.');
        const ledger = await tx.get(root.collection('cashMovements').limit(2001));
        if (ledger.size > 2000) fail('La caja requiere revisión por su volumen de movimientos.');
        if (cents(input.amount) > cents(payment.amount) + availablePersonalCents(ledger.docs.map(row => row.data()), actor.email)) fail('El monto supera el saldo disponible de tu caja.');
      }
      let receipt = payment.receipt || null;
      if (input.receipt && input.receipt.path !== receipt?.path) {
        if (!verifyPaymentReceipt) fail('No está disponible la verificación del comprobante.');
        receipt = { ...(await verifyPaymentReceipt({ projectId, collectionName: 'areaExpenses', itemId, paymentId }, input.receipt)), uploadedAt: new Date(), uploadedBy: actor.email };
      }
      const nextPayment = { ...payment, amount: cents(input.amount) / 100, date: input.date, detail: input.detail,
        type: totalPaid >= cents(expense.total) ? 'total' : 'partial', receipt };
      const nextHistory = history.map((row, position) => position === index ? nextPayment : row);
      // Use the existing server-owned cash revision to serialize concurrent
      // corrections across different expenses and subdeliveries in this project.
      if (movement && movement.cashAccount !== 'general') tx.update(root, { cashSubdeliveryRevision: Number(access.project.cashSubdeliveryRevision || 0) + 1 });
      tx.update(expenseRef, { paymentHistory: nextHistory, paid: totalPaid >= cents(expense.total), paymentLocked: true, lastFinancialAuditId: auditRef.id, updatedAt: timestamp() });
      if (movementRef) tx.update(movementRef, { amount: nextPayment.amount, date: input.date, notes: input.detail, updatedAt: timestamp() });
      tx.create(auditRef, { action: 'payment_corrected', collectionName: 'areaExpenses', itemId, paymentId, paymentIndex: index,
        cashMovementId: payment.cashMovementId || '', oldAmount: payment.amount, amount: nextPayment.amount, before: payment, after: nextPayment,
        fingerprint, deletedBy: actor.uid, deletedByEmail: actor.email, deletedByName: String(access.user?.displayName || actor.email), deletedByRole: collaborator?.role || access.user.role, createdAt: timestamp() });
      return { paymentHistory: clientValue(nextHistory), paid: totalPaid >= cents(expense.total), repeated: false };
    });
  };
}
module.exports = { createOwnPaymentCorrection, paymentCorrectionSnapshot };

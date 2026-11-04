const { HttpsError } = require('firebase-functions/v2/https');
const M = require('./providerPortalModel');
const { isInternalBudgetEstimate } = require('./internalBudgetEstimate');
const date = value => value?.toDate?.().toISOString() || (value instanceof Date ? value.toISOString() : M.text(value));
const cents = value => Math.round((Number(value) || 0) * 100);
function ownAdvances(expense, project, path, providerId) {
  if (isInternalBudgetEstimate(expense) || !M.ownExpense(expense, project, path)) return [];
  const [, projectId, collection, itemId] = path.split('/');
  return M.list(expense.paymentHistory).flatMap((payment, paymentIndex) => {
    if (payment.method !== 'tercero' || payment.thirdPartyPayerId !== providerId) return [];
    const reimbursements = M.list(payment.reimbursements).map((r, index) => ({
      id: M.text(r.id || index), index, amount: Number(r.amount) || 0, date: date(r.date), detail: M.text(r.detail),
      hasReceipt: Boolean(r.receipt?.path || r.receipt?.url),
    }));
    const advancedCents = cents(payment.amount), reimbursedCents = reimbursements.reduce((sum, r) => sum + cents(r.amount), 0);
    return [{ key: `${projectId}/${collection}/${itemId}/${paymentIndex}`, workKey: `${projectId}/${collection}/${itemId}`,
      projectName: M.text(project.name), description: M.text(expense.description), currency: M.text(expense.currency || 'ARS', 3),
      paymentIndex, paymentVersion: M.hash(payment), date: date(payment.date), amount: advancedCents / 100,
      reimbursed: reimbursedCents / 100, balance: Math.max(0, advancedCents - reimbursedCents) / 100,
      hasReceipt: Boolean(payment.receipt?.path || payment.receipt?.url), reimbursements }];
  });
}
function createPortalReimbursements({ db }) {
  return async providerId => {
    // Legacy third-party payers live inside paymentHistory arrays. Read a bounded,
    // minimal projection only on explicit request; never poll the global catalog.
    const snapshots = await Promise.all(['budgetItems', 'areaExpenses'].map(collection => db.collectionGroup(collection)
      .select('paymentHistory', 'area', 'description', 'currency', 'providerId', 'economicNature').limit(10001).get()));
    if (snapshots.some(s => s.size > 10000)) M.fail('El historial de reintegros requiere paginación. Pedí a administración que revise la consulta.');
    const projects = new Map(), result = [];
    for (const snapshot of snapshots) for (const doc of snapshot.docs) {
      if (!/^projects\/[^/]+\/(budgetItems|areaExpenses)\/[^/]+$/.test(doc.ref.path)) continue;
      const expense = doc.data();
      if (!M.list(expense.paymentHistory).some(p => p.method === 'tercero' && p.thirdPartyPayerId === providerId)) continue;
      const projectId = doc.ref.path.split('/')[1];
      if (!projects.has(projectId)) projects.set(projectId, (await db.doc(`projects/${projectId}`).get()).data());
      const project = projects.get(projectId);
      if (project) result.push(...ownAdvances(expense, project, doc.ref.path, providerId));
      if (result.length > 500) M.fail('Tu historial de reintegros requiere paginación. Pedí a administración que revise la consulta.');
    }
    return { advances: result };
  };
}
function ownAdvanceFile(expense, providerId, input) {
  const paymentIndex = Number(input.paymentIndex), reimbursementIndex = Number(input.index);
  if (!Number.isInteger(paymentIndex) || paymentIndex < 0 || paymentIndex > 500) M.fail('Pago inválido.');
  const payment = M.list(expense.paymentHistory)[paymentIndex];
  if (payment?.method !== 'tercero' || payment.thirdPartyPayerId !== providerId)
    throw new HttpsError('permission-denied', 'Este adelanto no pertenece a tu ficha.');
  if (M.hash(payment) !== input.paymentVersion) M.fail('El reintegro cambió. Actualizá la lista antes de descargar.');
  if (input.kind === 'advance') return { file: payment.receipt, paymentId: M.text(payment.id) };
  if (!Number.isInteger(reimbursementIndex) || reimbursementIndex < 0 || reimbursementIndex > 500) M.fail('Reintegro inválido.');
  const reimbursement = M.list(payment.reimbursements)[reimbursementIndex];
  return { file: reimbursement?.receipt, paymentId: M.text(payment.id), reimbursementId: M.text(reimbursement?.id) };
}
module.exports = { ownAdvances, createPortalReimbursements, ownAdvanceFile };

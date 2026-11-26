const { HttpsError } = require('firebase-functions/v2/https');
const { isInternalBudgetEstimate } = require('./internalBudgetEstimate');
const { canEditAreaExpense, deny } = require('./projectReadScope');
const { list } = require('./providerPortalModel');
const { canEditScopedExpensePayments } = require('./scopedExpensePayments');

const nameFields = ['type', 'name', 'lastName', 'fullName', 'businessName'];
const providerIdPattern = /^[\w-]{1,160}$/;
const catalogLimit = 5000;
const cacheDuration = 60_000;
const normalizeName = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function providerName(data) {
  const text = value => typeof value === 'string' ? value.trim() : '';
  const names = [text(data.name), text(data.lastName)].filter(Boolean).join(' ');
  return (data.type === 'empresa' ? text(data.businessName) || text(data.name) || text(data.fullName)
    : names || text(data.fullName)).slice(0, 300);
}

async function checkPickerExpense({ tx, db, access, actor, expense, scope, expectedUpdatedAt }) {
  if (access.admin || access.collaborator?.role !== 'jefe_produccion' || !canEditAreaExpense(access, expense)
    || isInternalBudgetEstimate(expense) || !list(access.project.activeAreas).includes(expense.area)) deny();

  const revision = expense.updatedAt?.seconds == null ? null : [expense.updatedAt.seconds, expense.updatedAt.nanoseconds || 0];
  if (JSON.stringify(expectedUpdatedAt) !== JSON.stringify(revision))
    throw new HttpsError('failed-precondition', 'El gasto cambió. Actualizá la fila y volvé a intentar.');
  if (!canEditScopedExpensePayments(expense, actor))
    throw new HttpsError('failed-precondition', 'El gasto tiene pagos de otra persona o sin autoría verificable.');
  if (expense.thirdPartyPayoutRequired || list(expense.sharedInvoices).length || list(expense.sharedReceipts).length
    || list(expense.sharedPaymentIds).length || list(expense.sharedPaymentRecords).length)
    throw new HttpsError('failed-precondition', 'El gasto tiene una autorización de cobro o comprobantes compartidos. Consultá a Administración.');
  await checkUnlinkedExpense({ tx, db, expense, scope });
}

async function checkUnlinkedExpense({ tx, db, expense, scope }) {
  // A provisional provider can have a pending invite without a reference on the row.
  const invites = expense.providerInviteLink ? null : await tx.get(db.collection('providerInvites')
    .where('expenseId', '==', scope.itemId).limit(41));
  if (expense.providerInviteLink || invites.size > 40 || invites.docs.some(doc => {
    const invite = doc.data();
    return invite.projectId === scope.projectId && (invite.collectionName || 'areaExpenses') === scope.collectionName
      && invite.status === 'pending' && invite.used !== true
      && (invite.expiresAt?.toMillis?.() ?? Infinity) > Date.now();
  })) throw new HttpsError('failed-precondition', 'La fila tiene un enlace de alta asociado. Pedile a Administración que lo desvincule para cambiar el proveedor.');
}

function createScopedProviderPicker(db) {
  let catalog;
  let expiresAt = 0;

  async function loadCatalog() {
    if (!catalog || Date.now() >= expiresAt) {
      expiresAt = Date.now() + cacheDuration;
      catalog = db.collection('providers').select(...nameFields).limit(catalogLimit + 1).get().then(snapshot => {
        if (snapshot.size > catalogLimit) throw new HttpsError('resource-exhausted', 'El padrón supera el límite de búsqueda. Consultá a Administración.');
        return snapshot.docs.filter(doc => providerIdPattern.test(doc.id)).flatMap(doc => {
          const name = providerName(doc.data());
          const normalized = normalizeName(name);
          return normalized ? [{ id: doc.id, name, normalized }] : [];
        }).sort((a, b) => a.normalized.localeCompare(b.normalized, 'es') || a.id.localeCompare(b.id));
      }).catch(error => { catalog = null; throw error; });
    }
    return catalog;
  }

  return async query => {
    if (typeof query !== 'string' || query.length > 100) throw new HttpsError('invalid-argument', 'Ingresá un nombre de hasta 100 caracteres.');
    const normalized = normalizeName(query);
    if (normalized.replace(/ /g, '').length < 3) return [];
    const words = normalized.split(' ');
    return (await loadCatalog()).filter(candidate => words.every(word => candidate.normalized.includes(word)))
      .slice(0, 20).map(({ id, name }) => ({ id, name }));
  };
}

module.exports = { checkPickerExpense, checkUnlinkedExpense, createScopedProviderPicker, providerName };

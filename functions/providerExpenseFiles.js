const { expenseInvoices, hash, list } = require('./providerPortalModel');

const fileKey = file => file?.path || file?.url;
const policyRef = (db, path) => db.doc(`${path}/providerFileOwnership/originals`);

function localFiles(expense) {
  return [...expenseInvoices(expense), ...list(expense.otherReceipts), ...list(expense.paymentHistory).map(payment => payment?.receipt)]
    .map(fileKey).filter(key => typeof key === 'string' && key);
}

async function retainOriginalFileOwners(db, tx, expenseRef, expense) {
  const keys = localFiles(expense);
  if (!keys.length) return null;
  const ref = policyRef(db, expenseRef.path);
  const saved = (await tx.get(ref)).data()?.owners || {};
  const owners = { ...saved, ...Object.fromEntries(keys.map(key => {
    const fingerprint = hash(key);
    return [fingerprint, saved[fingerprint] ?? (expense.providerId || '')];
  })) };
  return { ref, owners };
}

async function expenseFileVisibility(db, expenseRef, expense, providerId) {
  const owners = localFiles(expense).length ? (await policyRef(db, expenseRef.path).get()).data()?.owners : null;
  return file => {
    if (!owners || !fileKey(file)) return true;
    const owner = owners[hash(fileKey(file))];
    return owner === undefined || owner === providerId;
  };
}

module.exports = { retainOriginalFileOwners, expenseFileVisibility };

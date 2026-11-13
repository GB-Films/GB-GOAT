const test = require('node:test');
const assert = require('node:assert/strict');
const { hasPayments, canDelete } = require('./deleteUnpaidAreaExpense');
const { activeRecordAllocations } = require('./providerFinanceAllocations');
test('payment guards cover legacy paid flags, zero-value history, shared payments and malformed history', () => {
  assert.equal(hasPayments({ invoices: [{ path: 'invoice.pdf' }], paymentLocked: true, paymentHistory: [] }), false);
  for (const row of [{ paid: true }, { paymentHistory: [{ amount: 0 }] }, { paymentHistory: {} }, { sharedPaymentIds: ['p'] }, { sharedPaymentRecords: [{ id: 'p' }] }]) assert.equal(hasPayments(row), true);
});
test('deletion retains category editing and native/historical document administration boundaries', () => {
  const row = { area: 'Arte', subcategory: 'Utilería', invoices: [{ path: 'a.pdf' }] };
  const access = { collaborator: { canEditBudgetAreas: true, allowedTabs: ['areas'], allowedCategories: ['Arte'] } };
  assert.equal(canDelete(access, row), true);
  assert.equal(canDelete({ ...access, collaborator: { ...access.collaborator, excludedSubcategories: ['Arte||Utilería'] } }, row), false);
  assert.equal(canDelete(access, { ...row, paymentLocked: true }), false);
  assert.equal(canDelete(access, { ...row, sharedInvoices: [{ id: 'native' }] }), false);
  assert.equal(canDelete(access, { ...row, thirdPartyPayoutRequired: true }), false);
  assert.equal(canDelete(access, { ...row, thirdPartyPayoutRequired: null }), false);
  const noDefaultGroup = { collaborator: { ...access.collaborator, excludedSubcategories: ['Arte||'] } };
  assert.equal(canDelete(noDefaultGroup, { ...row, subcategory: '' }), false);
  assert.equal(canDelete(noDefaultGroup, { ...row, subcategory: 'Sin subcategoria' }), false, 'legacy default label cannot bypass an explicit exclusion');
  assert.equal(canDelete({ admin: true }, { ...row, paymentLocked: true, sharedInvoices: [{ id: 'native' }] }), true);
});
test('detachment excludes only the deleted target while preserving the fiscal original and unrelated applications', () => {
  const a = { projectId: 'p', collectionName: 'areaExpenses', itemId: 'a', amountCents: 100 }, b = { ...a, itemId: 'b' };
  const record = { allocations: [a, b], detachedExpenseKeys: ['p/areaExpenses/a'] }, before = structuredClone(record);
  assert.deepEqual(activeRecordAllocations(record), [b]); assert.deepEqual(record, before);
  assert.deepEqual(activeRecordAllocations({ allocations: [a, b] }), [a, b]);
});

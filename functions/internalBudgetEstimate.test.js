const test = require('node:test');
const assert = require('node:assert/strict');
const { isInternalBudgetEstimate } = require('./internalBudgetEstimate');
const { ownExpense } = require('./providerPortalModel');
const { createProviderFinanceHandler } = require('./providerFinance');
const { BANI_PROVIDER_ID } = require('./crmBaniPost');

const estimate = { providerId: BANI_PROVIDER_ID, economicNature: 'internal_estimate', area: 'Post Producción', total: 1500000 };
test('only explicitly classified BANI estimates are excluded from supplier works and debt', () => {
  assert.equal(isInternalBudgetEstimate(estimate), true);
  assert.equal(ownExpense(estimate, {}, 'projects/p/budgetItems/post'), null);
  assert.equal(isInternalBudgetEstimate({ ...estimate, economicNature: undefined }), false);
  assert.equal(isInternalBudgetEstimate({ ...estimate, providerId: 'external' }), false);
  assert.ok(ownExpense({ ...estimate, economicNature: undefined }, {}, 'projects/p/budgetItems/post'));
});

test('the shared finance backend rejects invoices and payments against the estimate before any write', async () => {
  let writes = 0;
  const records = new Map([
    ['users/operator', { role: 'admin' }], ['providers/' + BANI_PROVIDER_ID, { type: 'empresa' }],
    ['projects/p', { name: 'Local', activeAreas: [] }], ['projects/p/budgetItems/post', estimate],
  ]);
  const snapshot = ref => ({ id: ref.path.split('/').at(-1), exists: records.has(ref.path), data: () => records.get(ref.path) });
  const db = { doc: path => ({ path, get: async () => snapshot({ path }) }),
    runTransaction: async callback => callback({ get: async ref => snapshot(ref), create: () => { writes++; }, set: () => { writes++; }, update: () => { writes++; } }) };
  const handler = createProviderFinanceHandler({ db, timestamp: () => 123, verifyFile: async () => ({ path: 'test', fileName: 'test.pdf', sha256: 'a'.repeat(64) }) });
  for (const kind of ['payment', 'invoice']) {
    const data = { id: 'local-' + kind, action: 'create', kind, providerId: BANI_PROVIDER_ID, date: '2026-10-28',
      net: 1, total: 1, method: 'transfer', reference: 'LOCAL', payeeName: 'Local', account: 'Local',
      ...(kind === 'invoice' ? { documentOnly: true, file: { path: 'test' } } : {}),
      allocations: [{ projectId: 'p', collectionName: 'budgetItems', itemId: 'post', amount: kind === 'invoice' ? 1500000 : 1 }] };
    await assert.rejects(handler({ auth: { uid: 'operator', token: { email: 'admin@example.test' } }, data }), /estimación interna/);
  }
  assert.equal(writes, 0);
});

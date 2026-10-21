const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRecord } = require('./providerFinance');
const sample = () => ({ providerId: 'supplier', kind: 'invoice', date: '2026-10-15',
  issuerName: 'Emisor de prueba', issuerCuit: '20000000001', recipientCuit: '30000000002',
  number: 'C 00001-00000123', net: 1200, total: 1200,
  allocations: [300, 450, 450].map((amount, index) => ({ projectId: `project${index}`, collectionName: 'areaExpenses', itemId: 'expense', amount })) });
test('one invoice preserves fiscal issuer and exact allocations in cents', () => {
  const record = normalizeRecord(sample());
  assert.equal(record.netArsCents, 120000);
  assert.equal(record.allocations.reduce((sum, item) => sum + item.amountCents, 0), 120000);
  assert.equal(record.fiscalKey, normalizeRecord({ ...sample(), issuerCuit: '20-00000000-1' }).fiscalKey);
});
test('rejects uneven distributions, duplicate rows, invalid dates and arbitrary paths', () => {
  const value = sample();
  for (const changes of [{ net: 1201 }, { net: -1 }, { total: NaN }, { date: '2026-02-30' }, { date: 'bad' },
    { allocations: [value.allocations[0], value.allocations[0]] },
    { allocations: [{ ...value.allocations[0], projectId: '../outside' }] },
    { allocations: [{ ...value.allocations[0], collectionName: 'users' }] }]) assert.throws(() => normalizeRecord({ ...value, ...changes }));
});
test('separates recoverable VAT, withholding, fees, original currency and ARS cost', () => {
  const value = { ...sample(), kind: 'payment', net: 100, total: 120, withheld: 1, fee: 2, currency: 'USD', exchangeRate: 1200,
    method: 'transfer', reference: 'operation-test', payeeName: 'Beneficiario de prueba', account: 'Cuenta de prueba',
    allocations: [{ projectId: 'project', collectionName: 'budgetItems', itemId: 'expense', amount: 120000 }] };
  const record = normalizeRecord(value);
  assert.equal(record.netArsCents, 12000000);
  assert.equal(record.totalCents, 12000);
  assert.equal(record.withheldCents, 100);
  assert.equal(record.feeCents, 200);
  assert.throws(() => normalizeRecord({ ...value, exchangeRate: 0 }));
  assert.throws(() => normalizeRecord({ ...value, method: 'cash', cashProjectId: 'project' }));
});

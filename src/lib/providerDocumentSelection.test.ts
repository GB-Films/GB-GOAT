import test from 'node:test';
import assert from 'node:assert/strict';
import { documentProjectChoices, allocateProviderDocument } from './providerDocumentSelection';
const line = (id: string, projectId: string, total = 100, item = {}) => ({ expenseId: id, collectionName: 'areaExpenses', projectId, projectName: `Proyecto ${projectId}`, total, item });
test('invoice choices exclude legacy invoices, fully billed and zero costs, but not paid uninvoiced work', () => {
  const lines = [line('one', 'one'), line('two', 'two', 200, { sharedInvoices: [{ amountCents: 5000 }] }), line('legacy', 'legacy', 100, { invoice: { path: 'legacy.pdf' } }), line('billed', 'billed', 100, { sharedInvoices: [{ amountCents: 10000 }] }), line('zero', 'zero', 0)];
  const choices = documentProjectChoices(lines, 'invoice');
  assert.deepEqual(choices.map(row => [row.id, row.amountCents]), [['one', 10000], ['two', 15000]]);
  assert.deepEqual(allocateProviderDocument(lines, 'invoice', ['two']), [{ projectId: 'two', collectionName: 'areaExpenses', itemId: 'two', amount: 150 }]);
  assert.throws(() => allocateProviderDocument(lines, 'invoice', ['billed']), /Cambió el saldo/);
});
test('one project selects all its pending work using live invoices without double counting projections', () => {
  const lines = [line('one', 'same', 100, { sharedInvoices: [{ amountCents: 2000 }] }), line('two', 'same', 50)];
  const records = [{ kind: 'invoice', status: 'active', allocations: [{ projectId: 'same', collectionName: 'areaExpenses', itemId: 'one', amountCents: 2000 }] }];
  assert.equal(documentProjectChoices(lines, 'invoice', records)[0].amountCents, 13000);
  assert.equal(allocateProviderDocument(lines, 'invoice', ['same'], records).length, 2);
  records[0].allocations[0].amountCents = 10000;
  assert.equal(documentProjectChoices(lines, 'invoice', records)[0].amountCents, 5000);
  assert.throws(() => allocateProviderDocument(lines, 'other', []), /Seleccioná/);
  assert.equal(documentProjectChoices([line('legacy', 'legacy', 100, { invoice: { path: 'old' } })], 'other').length, 1);
});

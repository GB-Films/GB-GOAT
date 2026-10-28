import test from 'node:test';
import assert from 'node:assert/strict';
import { financialDocumentsForExpense, financialRecordProjects } from './providerFinancialRecords';

const allocations = [
  { projectId: 'one', projectName: 'Uno', collectionName: 'areaExpenses', itemId: 'a', amountCents: 30000, description: 'Sonido' },
  { projectId: 'two', projectName: 'Dos', collectionName: 'budgetItems', itemId: 'b', amountCents: 45000 },
  { projectId: 'three', projectName: 'Tres', collectionName: 'areaExpenses', itemId: 'c', amountCents: 45000 },
];
const invoice = { id: 'original', kind: 'invoice', number: 'C 0003-98', status: 'active', file: { fileName: 'Factura.pdf' }, allocations };
test('one invoice remains accessible from each allocated project using the same original ID', () => {
  for (const row of allocations) assert.deepEqual(financialDocumentsForExpense([invoice], { ...row, expenseId: row.itemId }), [{ id: 'original', kind: 'invoice', name: 'C 0003-98' }]);
  assert.equal(financialDocumentsForExpense([invoice], { ...allocations[0], expenseId: 'unrelated' }).length, 0);
  assert.equal(financialDocumentsForExpense([invoice], { ...allocations[0], expenseId: 'a', collectionName: 'budgetItems' }).length, 0);
});
test('cancelled records and payments without files do not become broken download links', () => {
  const records = [invoice, { ...invoice, id: 'void', status: 'cancelled' }, { ...invoice, id: 'cash', kind: 'payment', file: null }, { ...invoice, id: 'transfer', kind: 'payment' }];
  assert.deepEqual(financialDocumentsForExpense(records, { ...allocations[0], expenseId: 'a' }).map(row => row.id), ['original', 'transfer']);
});
test('project cards aggregate multiple expenses without repeating the project or changing the total', () => {
  const rows = financialRecordProjects([...allocations, { ...allocations[0], itemId: 'extra', amountCents: 5000, description: 'Edición' }]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].amountCents, 35000);
  assert.deepEqual(rows[0].descriptions, ['Sonido', 'Edición']);
  assert.equal(rows.reduce((sum, row) => sum + row.amountCents, 0), 125000);
});

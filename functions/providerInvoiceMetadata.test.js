const test = require('node:test');
const assert = require('node:assert/strict');
const { distinctInvoiceExpenseCount } = require('./providerInvoiceMetadata');
const first = { projectId: 'project-a', collectionName: 'areaExpenses', itemId: 'row' };
test('invoice metadata counts distinct native expense keys across projects and collections', () => {
  assert.equal(distinctInvoiceExpenseCount([first]), 1);
  assert.equal(distinctInvoiceExpenseCount([first, { ...first, amountCents: 300 }]), 1);
  assert.equal(distinctInvoiceExpenseCount([first, { ...first, itemId: 'second' }]), 2);
  assert.equal(distinctInvoiceExpenseCount([first, { ...first, projectId: 'project-b' }]), 2);
  assert.equal(distinctInvoiceExpenseCount([first, { ...first, collectionName: 'budgetItems' }]), 2);
  for (const rows of [null, [], [first, {}], [{ ...first, collectionName: 'private' }]]) assert.equal(distinctInvoiceExpenseCount(rows), null);
});

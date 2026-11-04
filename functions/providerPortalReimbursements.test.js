const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ownAdvances, ownAdvanceFile } = require('./providerPortalReimbursements');
const { hash } = require('./providerPortalModel');
const project = { name: 'Proyecto', activeAreas: ['Campo'] };
const payment = { id: 'p', method: 'tercero', thirdPartyPayerId: 'payer', amount: 100.15, date: '2026-11-04', receipt: { path: 'private/receipt', url: 'secret-token' },
  reimbursements: [{ id: 'r', amount: 30.1, date: '2026-11-04', createdByEmail: 'private-admin', cashMovementId: 'private-cash', receipt: { path: 'private/refund' } }] };
const expense = { providerId: 'other', area: 'Campo', total: 9000, invoice: { path: 'private/invoice' }, paymentHistory: [payment, { ...payment, thirdPartyPayerId: 'foreign', amount: 999 }], internalNotes: 'private-note' };
test('payer projection exposes only their advances and refunds, including expenses supplied by somebody else', () => {
  const rows = ownAdvances(expense, project, 'projects/project/areaExpenses/e', 'payer');
  assert.equal(rows.length, 1); assert.equal(rows[0].amount, 100.15); assert.equal(rows[0].reimbursed, 30.1); assert.equal(rows[0].balance, 70.05);
  assert.equal(rows[0].reimbursements[0].hasReceipt, true);
  assert(!JSON.stringify(rows).includes('private')); assert(!JSON.stringify(rows).includes('secret-token')); assert(rows.every(row => row.amount !== 999));
  assert.deepEqual(ownAdvances(expense, project, 'projects/project/budgetItems/mirror', 'payer'), []);
  assert.deepEqual(ownAdvances(expense, project, 'projects/project/areaExpenses/e', 'someone-else'), []);
});
test('advance downloads bind payer and exact payment version; reimbursement changes or reordered payments require refresh', () => {
  const input = { kind: 'reimbursement', paymentIndex: 0, index: 0, paymentVersion: hash(payment) };
  assert.equal(ownAdvanceFile(expense, 'payer', input).file.path, 'private/refund');
  assert.throws(() => ownAdvanceFile(expense, 'foreign', input));
  assert.throws(() => ownAdvanceFile({ ...expense, paymentHistory: [{ ...payment, amount: 2 }] }, 'payer', input), /cambió/);
  assert.throws(() => ownAdvanceFile(expense, 'payer', { ...input, paymentIndex: -1 }));
});

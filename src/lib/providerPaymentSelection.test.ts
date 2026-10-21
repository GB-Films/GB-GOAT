import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocateProviderPayment, paymentProjectChoices, payableProviderLines } from './providerPaymentSelection';

const line = (expenseId: string, projectId: string, debt: number) => ({ expenseId, projectId, projectName: projectId,
  collectionName: 'areaExpenses', description: expenseId, debt });

test('payment picker excludes settled expenses and projects, retaining only remaining balances', () => {
  const lines = [line('paid', 'old', 0), line('overpaid', 'old', -1), line('partial', 'new', 125.25), line('second', 'new', 50)];
  assert.deepEqual(payableProviderLines(lines).map(row => row.expenseId), ['partial', 'second']);
  assert.deepEqual(paymentProjectChoices(lines).map(project => [project.id, project.balanceCents]), [['new', 17525]]);
  assert.deepEqual(allocateProviderPayment(lines, ['old', 'new'], 175.25).map(row => [row.itemId, row.amount]), [['partial', 125.25], ['second', 50]]);
});

test('one amount covers selected projects and partial payments cannot exceed their live balances', () => {
  const lines = [line('a', 'garnier', 300000), line('b', 'stella', 450000), line('c', 'samsung', 450000)];
  assert.deepEqual(allocateProviderPayment(lines, ['stella', 'samsung'], 500000).map(row => [row.projectId, row.amount]), [['stella', 450000], ['samsung', 50000]]);
  assert.throws(() => allocateProviderPayment(lines, ['garnier'], 300000.01), /saldo/);
  assert.throws(() => allocateProviderPayment(lines, [], 1), /saldo/);
  assert.throws(() => allocateProviderPayment(lines, ['garnier'], 0), /saldo/);
  assert.throws(() => allocateProviderPayment(lines, ['garnier'], Number.NaN), /saldo/);
  assert.equal(allocateProviderPayment([line('a', 'x', 0.1), line('b', 'x', 0.2)], ['x'], 0.3).reduce((sum, row) => sum + Math.round(row.amount * 100), 0), 30);
});

test('link the single shared invoice only when its remaining allocation covers the payment', () => {
  const lines = [line('a', 'x', 100)];
  const allocation = { projectId: 'x', collectionName: 'areaExpenses', itemId: 'a', amountCents: 10000 };
  const invoice = { id: 'invoice', kind: 'invoice', status: 'active', allocations: [allocation], settlements: { prior: [{ ...allocation, amountCents: 6000 }] } };
  assert.equal(allocateProviderPayment(lines, ['x'], 40, [invoice])[0].invoiceId, 'invoice');
  assert.equal(allocateProviderPayment(lines, ['x'], 41, [invoice])[0].invoiceId, '');
  assert.equal(allocateProviderPayment(lines, ['x'], 40, [invoice, { ...invoice, id: 'second' }])[0].invoiceId, '');
  assert.equal(allocateProviderPayment(lines, ['x'], 40, [{ ...invoice, status: 'cancelled' }])[0].invoiceId, '');
});

test('respect the transaction limit and do not include extra expenses after partial payment is covered', () => {
  const lines = Array.from({ length: 31 }, (_, i) => line(String(i), 'x', 1));
  assert.throws(() => allocateProviderPayment(lines, ['x'], 31), /30 gastos/);
  assert.equal(allocateProviderPayment(lines, ['x'], 30).length, 30);
});

test('grouped projects are paid in their displayed order even when source expenses are interleaved', () => {
  const lines = [line('a1', 'a', 10), line('b1', 'b', 10), line('a2', 'a', 10)];
  assert.deepEqual(allocateProviderPayment(lines, ['a', 'b'], 25).map(row => [row.itemId, row.amount]), [['a1', 10], ['a2', 10], ['b1', 5]]);
});

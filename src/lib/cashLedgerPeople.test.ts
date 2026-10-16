import test from 'node:test';
import assert from 'node:assert/strict';
import { cashLedgerPeople } from './cashLedgerPeople';
import { calculateCashBalances } from './cashBoxes';

test('cash ledger retains historical recipients without treating general cash operators as custodians', () => {
  const movements = [
    { type: 'entrega', status: 'confirmed', toUserEmail: 'OLD@example.com', toUserName: 'Persona histórica', amount: 100 },
    { type: 'entrega', status: 'pending', toUserEmail: 'pending@example.com', amount: 50 },
    { type: 'pago', cashAccount: 'general', fromUserEmail: 'operator@example.com', amount: 20 },
    { type: 'transferencia', fromUserEmail: 'old@example.com', toUserEmail: 'new@example.com', amount: 30 },
    { type: 'devolucion', status: 'confirmed', fromUserEmail: 'old@example.com', toUserEmail: 'admin@example.com', amount: 10 },
  ];
  const people = cashLedgerPeople([], movements);
  assert.deepEqual(people.map(p => p.email).sort(), ['new@example.com', 'old@example.com', 'pending@example.com']);
  assert.ok(people.every(p => p.historicalOnly && p.allowedTabs.length === 0));
  assert.equal(calculateCashBalances(movements).get('old@example.com'), 60);
  assert.equal(calculateCashBalances(movements).get('pending@example.com'), undefined);
});

test('current members keep their existing role and permissions and do not mutate the recipient list', () => {
  const members = [{ email: 'person@example.com', displayName: 'Persona', role: 'admin' as const, allowedTabs: ['areas'], allowedCategories: ['Arte'] }];
  const rows = cashLedgerPeople(members, [{ type: 'entrega', toUserEmail: 'person@example.com', amount: 1 }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].historicalOnly, undefined);
  assert.equal(rows[0], members[0]);
  assert.equal(members.length, 1);
});

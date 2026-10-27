import test from 'node:test';
import assert from 'node:assert/strict';
import { cashLedgerEntry, cashMovementDate, sortCashMovements } from './cashLedgerView';
import { calculateCashBalances } from './cashBoxes';
import type { CashMovement } from '../pages/project-detail/types';

const movement = (data: Partial<CashMovement>): CashMovement => ({ id: 'm', type: 'entrega', amount: 100, date: '2026-10-27', ...data });
const entry = (data: CashMovement, account = 'ana@example.com') => cashLedgerEntry(data, account, [], []);

test('a delivery is income for its recipient and an outflow for General; pending reception stays separate from balance', () => {
  const delivery = movement({ toUserEmail: 'ANA@example.com', toUserName: 'Ana', status: 'pending' });
  assert.equal(entry(delivery).signedAmount, 100);
  assert.equal(entry(delivery).pending, true);
  assert.equal(entry(delivery, 'general').signedAmount, -100);
  assert.equal(entry(delivery, 'general').counterparty.name, 'Ana');
  assert.equal(calculateCashBalances([delivery]).get('ana@example.com') || 0, 0);
  assert.equal(calculateCashBalances([{ ...delivery, status: 'confirmed' }]).get('ana@example.com'), 100);
});

test('transfers identify the other person and reverse direction between the two cashboxes', () => {
  const transfer = movement({ type: 'transferencia', fromUserEmail: 'ana@example.com', fromUserName: 'Ana', toUserEmail: 'luz@example.com', toUserName: 'Luz' });
  assert.equal(entry(transfer).signedAmount, -100);
  assert.equal(entry(transfer).counterparty.name, 'Luz');
  assert.equal(entry(transfer, 'luz@example.com').signedAmount, 100);
  assert.equal(entry(transfer, 'luz@example.com').counterparty.name, 'Ana');
});

test('a return credits General rather than the receiving administrators personal cashbox', () => {
  const returned = movement({ type: 'devolucion', fromUserEmail: 'ana@example.com', toUserEmail: 'admin@example.com', status: 'confirmed' });
  assert.equal(entry(returned).signedAmount, -100);
  assert.equal(entry(returned, 'general').signedAmount, 100);
  assert.equal(entry({ ...returned, status: 'cancelled' }).cancelled, true);
  assert.equal(entry({ ...returned, status: 'pending' }).pending, true);
});

test('cash payments resolve the supplier from the correct linked expense collection and keep payment notes', () => {
  const payment = movement({ type: 'pago', itemId: 'same-id', collectionName: 'areaExpenses', description: 'Almuerzos', notes: 'Rodaje día 1' });
  const shown = cashLedgerEntry(payment, 'ana@example.com', [{ id: 'same-id', providerName: 'Otro' }], [{ id: 'same-id', providerName: 'Catering' }]);
  assert.equal(shown.counterparty.name, 'Catering');
  assert.equal(shown.description, 'Almuerzos · Rodaje día 1');
  assert.equal(shown.signedAmount, -100);
  assert.equal(entry(payment).counterparty.name, 'Sin proveedor registrado');
  assert.equal(entry({ ...payment, type: 'reintegro', thirdPartyPayerName: 'Luz' }).counterparty.name, 'Luz');
});

test('the displayed movement date determines order even when an older movement was entered later', () => {
  const older = movement({ id: 'older', date: '2026-10-25', createdAt: new Date('2026-10-28T15:00:00Z') });
  const newer = movement({ id: 'newer', date: { seconds: new Date('2026-10-27T15:00:00Z').getTime() / 1000 } });
  const fallback = movement({ id: 'fallback', date: null, createdAt: new Date('2026-10-26T15:00:00Z') });
  const original = [older, newer, fallback];
  assert.deepEqual(sortCashMovements(original).map(item => item.id), ['newer', 'fallback', 'older']);
  assert.equal(original[0], older);
  assert.equal(cashMovementDate('2026-10-27')?.getDate(), 27);
  assert.equal(cashMovementDate('invalid'), null);
});

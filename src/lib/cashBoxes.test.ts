import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateGeneralCashSummary, isGeneralCashMovement } from './cashBoxes';

test('las entregas legacy pertenecen a Caja General', () => {
  assert.equal(isGeneralCashMovement({ type: 'entrega' }), true);
});

test('Caja General separa salidas confirmadas y entregas pendientes', () => {
  const summary = calculateGeneralCashSummary([
    { type: 'entrega', status: 'confirmed', amount: 100 },
    { type: 'entrega', status: 'pending', amount: 40 },
    { type: 'pago', cashAccount: 'general', amount: 25 },
    { type: 'pago', cashAccount: 'personal', amount: 10 },
  ]);

  assert.equal(summary.confirmedDeliveries, 100);
  assert.equal(summary.pendingDeliveries, 40);
  assert.equal(summary.directPayments, 25);
  assert.equal(summary.totalOut, 125);
  assert.equal(summary.movements.length, 3);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPaymentCashBoxOptions, calculateGeneralCashSummary, isGeneralCashMovement } from './cashBoxes';

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

test('un administrador con caja asignada ve primero su caja y luego Caja General', () => {
  const options = buildPaymentCashBoxOptions({
    isProjectAdmin: true,
    hasPersonalCashBox: true,
    personalBalance: 750,
    currentUserEmail: 'admin@example.com',
    currentUserName: 'Admin Proyecto',
  });

  assert.deepEqual(options.map((option) => option.account), ['personal', 'general']);
  assert.equal(options[0].balance, 750);
  assert.equal(options[0].label, 'Caja asignada a Admin Proyecto');
  assert.equal(options[1].label, 'Caja General');
});

test('un administrador sin caja asignada conserva Caja General', () => {
  const options = buildPaymentCashBoxOptions({
    isProjectAdmin: true,
    hasPersonalCashBox: false,
    personalBalance: 0,
    currentUserEmail: 'admin@example.com',
    currentUserName: 'Admin Proyecto',
  });

  assert.deepEqual(options.map((option) => option.account), ['general']);
});

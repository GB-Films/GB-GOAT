import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPaymentCashBoxOptions, calculateCashBalances, calculateCashBoxSummaries, calculateGeneralCashSummary, isGeneralCashMovement, isPendingCashReceipt } from './cashBoxes';

test('el saldo visible se descuenta sólo al confirmar; el disponible reserva la entrega desde el inicio', () => {
  const funds = { type: 'entrega', status: 'confirmed', amount: 100, toUserEmail: 'a@example.test' };
  const transfer = { type: 'transferencia', status: 'pending', amount: 40, fromUserEmail: 'A@example.test', toUserEmail: 'b@example.test' };
  const summary = calculateCashBoxSummaries([funds, transfer]);
  assert.deepEqual(summary.get('a@example.test'), { balance: 100, available: 60, pendingOutgoing: 40, pendingIncoming: 0 });
  assert.deepEqual(summary.get('b@example.test'), { balance: 0, available: 0, pendingOutgoing: 0, pendingIncoming: 40 });
  assert.equal(calculateCashBalances([funds, transfer]).get('a@example.test'), 60, 'payment guards still use the reserved amount');
  const confirmed = calculateCashBoxSummaries([funds, { ...transfer, status: 'confirmed' }]);
  assert.deepEqual(confirmed.get('a@example.test'), { balance: 60, available: 60, pendingOutgoing: 0, pendingIncoming: 0 });
  assert.deepEqual(confirmed.get('b@example.test'), { balance: 40, available: 40, pendingOutgoing: 0, pendingIncoming: 0 });
  assert.equal(calculateCashBoxSummaries([funds, { ...transfer, status: 'cancelled' }]).get('a@example.test')?.balance, 100);
  assert.equal(calculateCashBoxSummaries([funds, { ...transfer, status: undefined }]).get('a@example.test')?.balance, 60, 'legacy transfers keep the existing confirmed balance');
});

test('las reservas acumuladas y las devoluciones pendientes no se ofrecen de nuevo como disponibles', () => {
  const movements = [
    { type: 'entrega', status: 'confirmed', amount: 100, toUserEmail: 'a@example.test' },
    ...[25, 15].map(amount => ({ type: 'transferencia', status: 'pending', amount, fromUserEmail: 'a@example.test', toUserEmail: 'b@example.test' })),
    { type: 'entrega', status: 'pending', amount: 80, toUserEmail: 'a@example.test' },
    { type: 'devolucion', status: 'pending', amount: 10, cashAccount: 'general', fromUserEmail: 'a@example.test', toUserEmail: 'admin@example.test' },
    { type: 'pago', cashAccount: 'personal', amount: 20, fromUserEmail: 'a@example.test' },
    { type: 'transferencia', status: 'cancelled', amount: 90, fromUserEmail: 'a@example.test', toUserEmail: 'b@example.test' },
  ];
  const original = structuredClone(movements), summary = calculateCashBoxSummaries(movements);
  assert.deepEqual(summary.get('a@example.test'), { balance: 80, available: 30, pendingOutgoing: 50, pendingIncoming: 80 });
  assert.equal(summary.has('admin@example.test'), false, 'return recipient does not get a personal incoming credit');
  assert.deepEqual(movements, original);
});

test('toda entrega personal reserva al emisor y sólo acredita al destinatario tras su confirmación', () => {
  const funds = { type: 'entrega', status: 'confirmed', amount: 100, toUserEmail: 'a@example.test' };
  const transfer = { type: 'transferencia', subdelivery: true, receiptVersion: 1, status: 'pending', amount: 40, fromUserEmail: 'a@example.test', toUserEmail: 'b@example.test' };
  const pending = calculateCashBalances([funds, transfer]);
  assert.equal(pending.get('a@example.test'), 60);
  assert.equal(pending.get('b@example.test') || 0, 0);
  assert.equal(isPendingCashReceipt(transfer), true);
  assert.equal(isPendingCashReceipt(funds), false);
  const confirmed = calculateCashBalances([funds, { ...transfer, status: 'confirmed' }]);
  assert.equal(confirmed.get('a@example.test'), 60, 'confirmation does not debit the sender twice');
  assert.equal(confirmed.get('b@example.test'), 40);
  assert.equal(calculateCashBalances([funds, { ...transfer, status: 'cancelled' }]).get('a@example.test'), 100);
  assert.equal(calculateCashBalances([funds, { ...transfer, status: undefined }]).get('b@example.test'), 40, 'historical transfers retain their established balances');
  assert.equal(calculateGeneralCashSummary([funds, transfer]).totalOut, 100);
});

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

test('un reintegro efectivo descuenta Caja General una sola vez', () => {
  const summary = calculateGeneralCashSummary([
    { type: 'reintegro', cashAccount: 'general', amount: 40 },
    { type: 'reintegro', cashAccount: 'personal', amount: 20 },
  ]);
  assert.equal(summary.directPayments, 40);
  assert.equal(summary.totalOut, 40);
});

test('una devolución pendiente no mueve cajas y una confirmada reduce sólo la caja de origen', () => {
  const deliveries = [{ type: 'entrega', status: 'confirmed', toUserEmail: 'Tecnica@ejemplo.com', amount: 100 }];
  const pending = { type: 'devolucion', status: 'pending', cashAccount: 'general', fromUserEmail: 'tecnica@ejemplo.com', toUserEmail: 'admin@ejemplo.com', amount: 40 };
  assert.equal(calculateCashBalances([...deliveries, pending]).get('tecnica@ejemplo.com'), 100);
  assert.equal(calculateGeneralCashSummary([...deliveries, pending]).totalOut, 100);
  const confirmed = { ...pending, status: 'confirmed' };
  const balances = calculateCashBalances([...deliveries, confirmed]);
  assert.equal(balances.get('tecnica@ejemplo.com'), 60);
  assert.equal(balances.has('admin@ejemplo.com'), false);
  const summary = calculateGeneralCashSummary([...deliveries, confirmed]);
  assert.equal(summary.confirmedReturns, 40);
  assert.equal(summary.totalOut, 60);
  const cancelled = { ...pending, status: 'cancelled' };
  assert.equal(calculateCashBalances([...deliveries, cancelled]).get('tecnica@ejemplo.com'), 100);
  assert.equal(calculateGeneralCashSummary([...deliveries, cancelled]).totalOut, 100);
});

test('un administrador con caja asignada ve primero su caja y luego Caja General', () => {
  const options = buildPaymentCashBoxOptions({
    isProjectAdmin: true,
    hasPersonalCashBox: true,
    personalBalance: 750,
    currentUserEmail: 'tomas@granberta.com',
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
    currentUserEmail: 'tomas@granberta.com',
    currentUserName: 'Admin Proyecto',
  });

  assert.deepEqual(options.map((option) => option.account), ['general']);
});

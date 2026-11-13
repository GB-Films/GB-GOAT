import test from 'node:test';
import assert from 'node:assert/strict';
import { canDeleteUnpaidAreaExpense, unpaidExpenseDeletionConfirmation } from './expenseDeletion';
test('an unpaid row remains deletable with many invoices and an administrator can remove a historical cleared row', () => {
  const row = { paid: false, paymentHistory: [], invoices: Array.from({ length: 24 }, (_, i) => ({ id: String(i), path: `invoice-${i}.pdf` })) };
  assert.equal(canDeleteUnpaidAreaExpense(row, false), true);
  assert.equal(canDeleteUnpaidAreaExpense({ ...row, paymentLocked: true }, true), true);
  assert.equal(canDeleteUnpaidAreaExpense({ ...row, paymentLocked: true }, false), false);
  assert.equal(canDeleteUnpaidAreaExpense({ ...row, sharedInvoices: [{ id: 'native' }] }, true), true);
  assert.equal(canDeleteUnpaidAreaExpense({ ...row, sharedInvoices: [{ id: 'native' }] }, false), false);
  assert.equal(canDeleteUnpaidAreaExpense({ ...row, thirdPartyPayoutRequired: true }, false), false);
  assert.equal(canDeleteUnpaidAreaExpense({ ...row, thirdPartyPayoutRequired: null }, false), false);
  for (const change of [{ paid: true }, { paymentHistory: [{ amount: 0 }] }, { paymentHistory: {} }, { sharedPaymentIds: ['native-payment'] }, { sharedPaymentRecords: [{ id: 'native-payment' }] }]) assert.equal(canDeleteUnpaidAreaExpense({ ...row, ...change }, true), false);
});
test('confirmation explicitly warns that this row loses its invoices while shared originals remain elsewhere', () => {
  const source = { label: 'Gasto ficticio', area: 'Producción', total: 476892, invoiceCount: 24 };
  const warning = unpaidExpenseDeletionConfirmation(source);
  assert.match(warning, /las 24 facturas cargadas/); assert.match(warning, /originales compartidos con otras filas se conservarán/); assert.match(warning, /no se puede deshacer/);
  assert.match(unpaidExpenseDeletionConfirmation({ ...source, invoiceCount: 1 }), /la factura cargada/);
  assert.doesNotMatch(unpaidExpenseDeletionConfirmation({ ...source, invoiceCount: 0 }), /facturas cargadas/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { canDeleteUnpaidAreaExpense, deleteUnpaidExpenseWithConfirmation, unpaidExpenseDeletionConfirmation, unpaidExpenseDeletionErrorMessage } from './expenseDeletion';
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

test('a third-party authorization is not a payment; an administrator can delete an unpaid row without a paid flag', () => {
  const row = { paymentHistory: [], paymentLocked: false, subcategory: '', thirdPartyPayoutRequired: true, invoice: { path: 'fake.pdf' }, invoices: [{ path: 'fake.pdf' }] };
  assert.equal(canDeleteUnpaidAreaExpense(row, true), true);
  assert.equal(canDeleteUnpaidAreaExpense(row, false), false, 'existing third-party document administration stays protected');
  assert.equal(canDeleteUnpaidAreaExpense({ ...row, paymentHistory: [{ amount: 1 }] }, true), false);
});

test('the actual deletion flow previews invoice removal and uses the server instead of a direct SDK delete', async () => {
  const sent: Record<string, unknown>[] = [], warnings: string[] = [];
  const result = await deleteUnpaidExpenseWithConfirmation({ projectId: 'fake-project', itemId: 'fake-row', newId: () => 'operation', isCurrent: () => true,
    request: async data => { sent.push(data); return { fingerprint: 'fingerprint', label: 'Gasto ficticio', area: 'Campo', total: 100, invoiceCount: 1 }; },
    confirm: warning => { warnings.push(warning); return true; } });
  assert.equal(result, true); assert.match(warnings[0], /la factura cargada/);
  assert.deepEqual(sent, [
    { action: 'previewDeleteUnpaidAreaExpense', projectId: 'fake-project', itemId: 'fake-row' },
    { action: 'deleteUnpaidAreaExpense', projectId: 'fake-project', itemId: 'fake-row', operationId: 'operation', expectedFingerprint: 'fingerprint' },
  ]);
});

test('cancel, changed account/project, and a rejected preview never submit a deletion', async () => {
  for (const scenario of ['cancel', 'scope', 'denied']) {
    let calls = 0;
    const run = () => deleteUnpaidExpenseWithConfirmation({ projectId: 'fake', itemId: 'row', isCurrent: () => scenario !== 'scope', confirm: () => scenario !== 'cancel',
      request: async () => { calls++; if (scenario === 'denied') throw { code: 'functions/permission-denied' }; return { label: 'Gasto', area: 'Campo', total: 100, invoiceCount: 0 }; } });
    if (scenario === 'denied') await assert.rejects(run()); else assert.equal(await run(), false);
    assert.equal(calls, 1);
  }
});

test('a changed payment gets a clear explanation; session and connection failures have concrete next steps', () => {
  const message = 'No se puede eliminar la fila: tiene pagos registrados. Revisá Gestión de pagos.';
  assert.equal(unpaidExpenseDeletionErrorMessage({ code: 'functions/failed-precondition', message }), message);
  assert.match(unpaidExpenseDeletionErrorMessage({ code: 'functions/unauthenticated' }), /Volvé a ingresar/);
  assert.match(unpaidExpenseDeletionErrorMessage({ code: 'permission-denied', message: 'Missing or insufficient permissions.' }), /administrador del proyecto/);
  assert.match(unpaidExpenseDeletionErrorMessage(Error('internal')), /si la fila sigue apareciendo/);
  assert.doesNotMatch(unpaidExpenseDeletionErrorMessage(Error('internal')), /internal|403|Firebase/);
});
test('confirmation explicitly warns that this row loses its invoices while shared originals remain elsewhere', () => {
  const source = { label: 'Gasto ficticio', area: 'Producción', total: 476892, invoiceCount: 24 };
  const warning = unpaidExpenseDeletionConfirmation(source);
  assert.match(warning, /las 24 facturas cargadas/); assert.match(warning, /originales compartidos con otras filas se conservarán/); assert.match(warning, /no se puede deshacer/);
  assert.match(unpaidExpenseDeletionConfirmation({ ...source, invoiceCount: 1 }), /la factura cargada/);
  assert.doesNotMatch(unpaidExpenseDeletionConfirmation({ ...source, invoiceCount: 0 }), /facturas cargadas/);
});

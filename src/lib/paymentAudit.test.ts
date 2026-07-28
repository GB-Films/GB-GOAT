import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPaymentAuditAppend } from './paymentAudit';

test('inicializa la auditoría al pagar un gasto legacy', () => {
  assert.deepEqual(buildPaymentAuditAppend(undefined, 'user-2'), {
    paymentLocked: true,
    paymentAuthorIds: ['user-2'],
  });
});

test('conserva los autores auditados y agrega al autor del nuevo pago', () => {
  assert.deepEqual(buildPaymentAuditAppend(['user-1'], 'user-2'), {
    paymentLocked: true,
    paymentAuthorIds: ['user-1', 'user-2'],
  });
});

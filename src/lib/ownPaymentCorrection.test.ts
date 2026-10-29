import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { paymentCorrectionSnapshot } from './ownPaymentCorrection';
import { canEditExistingPayment } from './projectAccess';
const require = createRequire(import.meta.url);
const server = require('../../functions/paymentCorrectionSnapshot');
test('only the original author can correct a normal payment; missing and shared authorship does not confer access', () => {
  const payment = { id: 'p', createdBy: 'own', createdByEmail: 'own@example.test' };
  assert.equal(canEditExistingPayment(false, payment, 'own', 'own@example.test'), true);
  for (const value of [{ ...payment, createdBy: 'other' }, { ...payment, createdByEmail: 'other@example.test' }, { ...payment, id: '' }, { ...payment, sharedRecordId: 's' }])
    assert.equal(canEditExistingPayment(false, value, 'own', 'own@example.test'), false);
  assert.equal(canEditExistingPayment(false), false);
  assert.equal(canEditExistingPayment(true), true);
});
test('client and server agree on the opened payment snapshot for timestamp and serialized dates', () => {
  for (const date of [new Date('2026-10-29T12:00:00Z'), '2026-10-29', { seconds: 100, nanoseconds: 123456789 }, undefined]) {
    const payment = { id: 'p', amount: 20, date, createdBy: 'own', createdByEmail: 'own@example.test', receipt: { path: 'private/path' } };
    assert.deepEqual(paymentCorrectionSnapshot(payment), server.paymentCorrectionSnapshot(payment));
  }
});

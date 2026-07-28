import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePaymentAmount } from './paymentAmounts';

test('acepta importes enteros y separadores de miles argentinos', () => {
  assert.equal(parsePaymentAmount('2530000'), 2530000);
  assert.equal(parsePaymentAmount('2.530.000'), 2530000);
  assert.equal(parsePaymentAmount('2,530,000'), 2530000);
});

test('acepta decimales con coma o punto', () => {
  assert.equal(parsePaymentAmount('2530000,50'), 2530000.5);
  assert.equal(parsePaymentAmount('2530000.50'), 2530000.5);
});

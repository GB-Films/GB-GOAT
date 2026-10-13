import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCanChangePaymentCash, canChangePaymentCash } from './paymentCashAccess';
test('administrative corrections allow general cash, own cash and payments without cash', () => {
  assert.equal(canChangePaymentCash({}, 'admin@example.test'), true);
  assert.equal(canChangePaymentCash({ cashMovementId: 'm', cashAccount: 'general', paidByEmail: 'other@example.test' }, 'admin@example.test'), true);
  assert.equal(canChangePaymentCash({ cashMovementId: 'm', cashAccount: 'personal', paidByEmail: 'ADMIN@example.test' }, 'admin@example.test'), true);
});
test('the actual movement controls permissions, including legacy payments and misleading metadata', () => {
  assert.throws(() => assertCanChangePaymentCash({ cashMovementId: 'm', cashAccount: 'general' }, 'admin@example.test', {cashAccount:'personal',fromUserEmail:'other@example.test'}), /OTHER_PERSON_CASH_BOX/);
  assert.equal(canChangePaymentCash({cashMovementId:'m'}, 'admin@example.test', {cashAccount:'general'}), true);
  assert.equal(canChangePaymentCash({cashMovementId:'m'}, 'admin@example.test'), false);
});

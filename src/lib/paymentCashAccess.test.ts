import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCanChangePaymentCash, canChangePaymentCash } from './paymentCashAccess';
test('General custodians can correct General payments, their own cash and payments without cash', () => {
  assert.equal(canChangePaymentCash({}, 'tomas@granberta.com'), true);
  assert.equal(canChangePaymentCash({ cashMovementId: 'm', cashAccount: 'general', paidByEmail: 'other@example.test' }, 'tomas@granberta.com'), true);
  assert.equal(canChangePaymentCash({ cashMovementId: 'm', cashAccount: 'personal', paidByEmail: 'TOMAS@GRANBERTA.COM' }, 'tomas@granberta.com'), true);
});
test('the actual movement controls permissions, including legacy payments and misleading metadata', () => {
  assert.throws(() => assertCanChangePaymentCash({ cashMovementId: 'm', cashAccount: 'general' }, 'tomas@granberta.com', {cashAccount:'personal',fromUserEmail:'other@example.test'}), /OTHER_PERSON_CASH_BOX/);
  assert.equal(canChangePaymentCash({cashMovementId:'m'}, 'tomas@granberta.com', {cashAccount:'general'}), true);
  assert.equal(canChangePaymentCash({cashMovementId:'m'}, 'tomas@granberta.com'), false);
});

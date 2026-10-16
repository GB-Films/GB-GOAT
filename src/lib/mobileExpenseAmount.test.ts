import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileExpenseAmountUpdate } from './mobileExpenseAmount';
import { prepareExpenseEdit } from './expenseEdits';

test('mobile total accepts Argentine amounts and preserves quantity, deriving unit price', () => {
  assert.deepEqual(mobileExpenseAmountUpdate('12.345,67', '1'), { total: 12345.67, quantity: 1, unitPrice: 12345.67 });
  assert.deepEqual(mobileExpenseAmountUpdate('100,50', '3'), { total: 100.5, quantity: 3, unitPrice: 33.5 });
  assert.deepEqual(mobileExpenseAmountUpdate('25.50', '0,5'), { total: 25.5, quantity: 0.5, unitPrice: 51 });
  assert.deepEqual(mobileExpenseAmountUpdate('0', '1'), { total: 0, quantity: 1, unitPrice: 0 });
  assert.equal(mobileExpenseAmountUpdate('100', '3').unitPrice * 3, 100);
});

test('mobile total rejects blank, negative, nonnumeric amounts and invalid quantities', () => {
  for (const [total, quantity] of [['', '1'], ['-1', '1'], ['abc', '1'], ['1e3', '1'], ['100', '0'], ['100', '-1'], ['100', ''], ['100', 'abc']]) {
    assert.throws(() => mobileExpenseAmountUpdate(total, quantity));
  }
});

test('mobile amounts pass existing expense validation and cannot edit a paid expense', () => {
  const update = mobileExpenseAmountUpdate('100,50', '3');
  const unpaid = { total: 0, quantity: 1, unitPrice: 0, paid: false, paymentHistory: [] };
  assert.equal(prepareExpenseEdit(unpaid, update, { isProjectAdmin: false }).total, 100.5);
  assert.throws(() => prepareExpenseEdit({ ...unpaid, paymentLocked: true, paymentHistory: [{ amount: 50 }] }, update, { isProjectAdmin: true }), /PAID_EXPENSE_LOCKED/);
  assert.equal(prepareExpenseEdit({ ...unpaid, paymentLocked: true }, update, { isProjectAdmin: true }).total, 100.5);
});

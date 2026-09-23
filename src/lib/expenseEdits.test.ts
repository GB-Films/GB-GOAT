import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCashPaymentLink, findCurrentPayment, prepareExpenseEdit, samePaymentTarget } from './expenseEdits';

const paidGimbal = {
  description: 'Alquiler de Gimbal', quantity: 1, unitPrice: 87000, total: 87000,
  paymentLocked: true, paymentHistory: [{ amount: 87000 }],
  updatedAt: { seconds: 10, nanoseconds: 1 },
};

test('a collaborator cannot turn a paid expense into a different row', () => {
  assert.throws(() => prepareExpenseEdit(paidGimbal, {
    description: 'Gastos de Arte', unitPrice: 25000, total: 25000,
  }, { isProjectAdmin: false, expectedUpdatedAt: paidGimbal.updatedAt }), /PAID_EXPENSE_LOCKED/);
});

test('an admin cannot repurpose an expense after payment', () => {
  assert.throws(() => prepareExpenseEdit(paidGimbal, { unitPrice: 25000 }, {
    isProjectAdmin: true, expectedUpdatedAt: paidGimbal.updatedAt,
  }), /PAID_EXPENSE_LOCKED/);
});

test('stale edits fail instead of overwriting a concurrent change', () => {
  assert.throws(() => prepareExpenseEdit(paidGimbal, { paymentDate: '2026-09-23' }, {
    isProjectAdmin: true, expectedUpdatedAt: { seconds: 9, nanoseconds: 1 },
  }), /EXPENSE_CHANGED/);
});

test('quantity and price use the latest stored counterpart', () => {
  const next = prepareExpenseEdit({ quantity: 2, unitPrice: 100, total: 200 }, {
    unitPrice: 150, total: 150,
  }, { isProjectAdmin: false });
  assert.equal(next.total, 300);
});

test('a payment rejects a row repurposed while its dialog was open', () => {
  assert.equal(samePaymentTarget(paidGimbal, {
    ...paidGimbal, description: 'Gastos de Arte', providerId: 'carolina', total: 25000,
  }), false);
});

test('payment edits reject a concurrent correction, including legacy index payments', () => {
  const opened = { amount: 100, date: { seconds: 10, nanoseconds: 0 }, cashMovementId: 'cash-1' };
  assert.equal(findCurrentPayment([opened], opened, 0).index, 0);
  assert.throws(() => findCurrentPayment([{ ...opened, amount: 125 }], opened, 0), /PAYMENT_CHANGED/);
  assert.throws(() => findCurrentPayment([opened, { ...opened, cashMovementId: 'cash-2' }], opened, 1), /PAYMENT_CHANGED/);
});

test('a cash movement must still point to the selected payment and amount', () => {
  const payment = { id: 'pay-1', amount: 100 };
  assert.doesNotThrow(() => assertCashPaymentLink(
    { type: 'pago', collectionName: 'areaExpenses', itemId: 'expense-1', paymentId: 'pay-1', amount: 100 },
    { collectionName: 'areaExpenses', itemId: 'expense-1', payment },
  ));
  assert.throws(() => assertCashPaymentLink(
    { type: 'pago', collectionName: 'areaExpenses', itemId: 'expense-1', paymentId: 'pay-1', amount: 99 },
    { collectionName: 'areaExpenses', itemId: 'expense-1', payment },
  ), /CASH_LINK_MISMATCH/);
});

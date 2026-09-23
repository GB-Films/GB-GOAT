import assert from 'node:assert/strict';
import test from 'node:test';
import { assertReimbursementAmount, getCompanyPaid, getItemReimbursementBalance, getReimbursementBalanceCents } from './reimbursements';

test('third-party payment moves debt to the payer without duplicating project cost', () => {
  const item = { total: 100, paymentHistory: [
    { id: 'external', amount: 60, method: 'tercero', thirdPartyPayerId: 'person-1', thirdPartyPayerName: 'Persona Ejemplo', reimbursements: [
      { id: 'refund-1', amount: 20, date: '', cashMovementId: 'cash-1', cashAccount: 'general' as const, createdBy: 'admin', createdByEmail: 'admin@example.test' },
    ] },
    { id: 'company', amount: 40, method: 'otro' },
  ] };
  assert.equal(getItemReimbursementBalance(item), 40);
  assert.equal(getCompanyPaid(item), 60);
  assert.equal(getCompanyPaid(item) + getItemReimbursementBalance(item), item.total);
});

test('partial reimbursements cannot exceed the third-party payment', () => {
  const payment = { amount: 85, method: 'tercero', thirdPartyPayerId: 'person-1', thirdPartyPayerName: 'Persona Ejemplo', reimbursements: [
    { id: 'first', amount: 30, date: '', cashMovementId: 'cash-1', cashAccount: 'general' as const, createdBy: 'admin', createdByEmail: 'admin@example.test' },
  ] };
  assert.equal(getReimbursementBalanceCents(payment), 5500);
  assert.doesNotThrow(() => assertReimbursementAmount(payment, 55));
  assert.throws(() => assertReimbursementAmount(payment, 55.01), /INVALID_REIMBURSEMENT/);
});

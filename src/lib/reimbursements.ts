export type ReimbursementRecord = {
  id: string;
  amount: number;
  date: unknown;
  detail?: string;
  cashMovementId: string;
  cashAccount: 'general' | 'personal';
  createdBy: string;
  createdByEmail: string;
};

export type ThirdPartyPayment = {
  id?: string;
  amount: number;
  method?: string;
  thirdPartyPayerId?: string;
  thirdPartyPayerName?: string;
  reimbursements?: ReimbursementRecord[];
  reimbursedAmount?: number;
};

const cents = (amount: unknown) => Math.round((Number(amount) || 0) * 100);

export const isThirdPartyPayment = (payment: ThirdPartyPayment) => payment.method === 'tercero';

export const getReimbursedCents = (payment: ThirdPartyPayment) => (
  Array.isArray(payment.reimbursements)
    ? payment.reimbursements.reduce((total, reimbursement) => total + cents(reimbursement.amount), 0)
    : 0
);

export const getReimbursementBalanceCents = (payment: ThirdPartyPayment) => (
  isThirdPartyPayment(payment) ? Math.max(0, cents(payment.amount) - getReimbursedCents(payment)) : 0
);

export const getItemReimbursementBalance = (item: { paymentHistory?: ThirdPartyPayment[] }) => (
  (Array.isArray(item.paymentHistory) ? item.paymentHistory : [])
    .reduce((total, payment) => total + getReimbursementBalanceCents(payment), 0) / 100
);

export const getCompanyPaid = (item: { paymentHistory?: ThirdPartyPayment[] }) => (
  (Array.isArray(item.paymentHistory) ? item.paymentHistory : [])
    .reduce((total, payment) => total + (isThirdPartyPayment(payment)
      ? getReimbursedCents(payment) : cents(payment.amount)), 0) / 100
);

export const assertReimbursementAmount = (payment: ThirdPartyPayment, amount: number) => {
  if (!isThirdPartyPayment(payment) || !payment.thirdPartyPayerId || !payment.thirdPartyPayerName
    || !Number.isFinite(amount) || cents(amount) <= 0
    || cents(amount) > getReimbursementBalanceCents(payment)) {
    throw new Error('INVALID_REIMBURSEMENT');
  }
};

export const assertReimbursementCashLink = (
  movement: { type?: string; collectionName?: string; itemId?: string; paymentId?: string; reimbursementId?: string; amount?: number; thirdPartyPayerId?: string },
  expected: { collectionName: string; itemId: string; payment: ThirdPartyPayment; reimbursement: ReimbursementRecord },
) => {
  if (movement.type !== 'reintegro' || movement.collectionName !== expected.collectionName
    || movement.itemId !== expected.itemId || movement.paymentId !== expected.payment.id
    || movement.reimbursementId !== expected.reimbursement.id
    || movement.thirdPartyPayerId !== expected.payment.thirdPartyPayerId
    || cents(movement.amount) !== cents(expected.reimbursement.amount)) {
    throw new Error('REIMBURSEMENT_CASH_MISMATCH');
  }
};

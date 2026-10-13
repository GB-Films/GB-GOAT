type PaymentCash = { cashMovementId?: string; cashAccount?: string; paidByEmail?: string };
type CashSource = { cashAccount?: string; fromUserEmail?: string };
const email = (value?: string) => String(value || '').trim().toLowerCase();

// El permiso administrativo no permite modificar el saldo de otra caja asignada.
export function canChangePaymentCash(payment: PaymentCash, actorEmail: string, movement?: CashSource | null) {
  if (!payment.cashMovementId) return true;
  const account = movement ? movement.cashAccount : payment.cashAccount;
  const owner = movement ? movement.fromUserEmail : payment.paidByEmail;
  return account === 'general' || Boolean(email(actorEmail) && email(owner) === email(actorEmail));
}

export function assertCanChangePaymentCash(payment: PaymentCash, actorEmail: string, movement?: CashSource | null) {
  if (!canChangePaymentCash(payment, actorEmail, movement)) throw new Error('OTHER_PERSON_CASH_BOX');
}

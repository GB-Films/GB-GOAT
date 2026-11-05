export const GENERAL_CASH_EMAILS = [
  'tomas@granberta.com',
  'agustin@granberta.com',
  'guido@bani-vfx.com',
] as const;

// This permission is independent of the application/project administrator role.
export const canAccessGeneralCash = (email?: string | null) =>
  (GENERAL_CASH_EMAILS as readonly string[]).includes(String(email || '').trim().toLowerCase());

// Counterparties retain their own delivery/return history, not the global ledger.
export const canReadCashMovement = (email: string, movement: { fromUserEmail?: string; toUserEmail?: string; cashAccount?: string; type?: string }, includeGeneral = true) => {
  const actor = email.trim().toLowerCase();
  if (includeGeneral && canAccessGeneralCash(actor)) return true;
  if (movement.type === 'entrega') return Boolean(actor && String(movement.toUserEmail || '').toLowerCase() === actor);
  if (movement.type === 'devolucion') return Boolean(actor && String(movement.fromUserEmail || '').toLowerCase() === actor);
  if (movement.cashAccount === 'general') return false;
  return Boolean(actor && [movement.fromUserEmail, movement.toUserEmail]
    .some(value => String(value || '').trim().toLowerCase() === actor));
};

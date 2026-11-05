const GENERAL_CASH_EMAILS = Object.freeze([
  'tomas@granberta.com',
  'agustin@granberta.com',
  'guido@bani-vfx.com',
]);
const canAccessGeneralCash = email => GENERAL_CASH_EMAILS.includes(String(email || '').trim().toLowerCase());
const canReadPersonalCashMovement = (email, movement) => {
  const actor = String(email || '').trim().toLowerCase();
  if (movement.type === 'entrega') return Boolean(actor && String(movement.toUserEmail || '').toLowerCase() === actor);
  if (movement.type === 'devolucion') return Boolean(actor && String(movement.fromUserEmail || '').toLowerCase() === actor);
  if (movement.cashAccount === 'general') return false;
  return Boolean(actor && [movement.fromUserEmail, movement.toUserEmail].some(value => String(value || '').trim().toLowerCase() === actor));
};
module.exports = { GENERAL_CASH_EMAILS, canAccessGeneralCash, canReadPersonalCashMovement };

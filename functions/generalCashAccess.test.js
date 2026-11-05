const test = require('node:test');
const assert = require('node:assert/strict');
const { GENERAL_CASH_EMAILS, canAccessGeneralCash, canReadPersonalCashMovement } = require('./generalCashAccess');

test('General cash has exactly the three named accounts, without an app-owner override', () => {
  assert.deepEqual(GENERAL_CASH_EMAILS, ['tomas@granberta.com', 'agustin@granberta.com', 'guido@bani-vfx.com']);
  for (const email of GENERAL_CASH_EMAILS) assert.equal(canAccessGeneralCash(email.toUpperCase()), true);
  for (const email of [undefined, 'info@granbertafilms.com', 'admin@example.test', 'tomas@granberta.com.evil']) assert.equal(canAccessGeneralCash(email), false);
});

test('a personal ledger never includes old General payments or General custodian activity', () => {
  const email = 'former-admin@example.test', other = 'other@example.test';
  for (const row of [
    { type: 'pago', cashAccount: 'general', fromUserEmail: email },
    { type: 'reintegro', cashAccount: 'general', fromUserEmail: email },
    { type: 'entrega', cashAccount: 'general', fromUserEmail: email, toUserEmail: other },
    { type: 'devolucion', cashAccount: 'general', fromUserEmail: other, toUserEmail: email },
    { type: 'pago', cashAccount: 'personal', fromUserEmail: other },
  ]) assert.equal(canReadPersonalCashMovement(email, row), false);
  for (const row of [
    { type: 'pago', fromUserEmail: email },
    { type: 'pago', cashAccount: 'personal', fromUserEmail: email },
    { type: 'transferencia', cashAccount: 'personal', toUserEmail: email },
    { type: 'entrega', cashAccount: 'general', toUserEmail: email },
    { type: 'devolucion', cashAccount: 'general', fromUserEmail: email },
  ]) assert.equal(canReadPersonalCashMovement(email, row), true);
});

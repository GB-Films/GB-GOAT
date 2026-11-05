import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { GENERAL_CASH_EMAILS, canAccessGeneralCash, canReadCashMovement } from './generalCashAccess';
import { buildPaymentCashBoxOptions } from './cashBoxes';
import { canChangePaymentCash } from './paymentCashAccess';
import { buildAssistantCapabilities } from './assistantCapabilities';

test('Caja General tiene una lista cerrada, igual en cliente, servidor y reglas', () => {
  const require = createRequire(import.meta.url);
  const backend = require('../../functions/generalCashAccess.js');
  assert.deepEqual([...GENERAL_CASH_EMAILS], backend.GENERAL_CASH_EMAILS);
  const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
  const helper = rules.match(/function hasGeneralCashAccess\(\) \{([\s\S]*?)\n    \}/)![1];
  assert.deepEqual([...helper.matchAll(/'([^']+@[^']+)'/g)].map(match => match[1]), [...GENERAL_CASH_EMAILS]);
  for (const email of GENERAL_CASH_EMAILS) {
    assert.equal(canAccessGeneralCash(email), true);
    assert.equal(backend.canAccessGeneralCash(email), true);
    assert.equal(canAccessGeneralCash(` ${email.toUpperCase()} `), true);
  }
  for (const email of ['', undefined, 'info@granbertafilms.com', 'admin@example.test', 'tomas@granberta.com.evil', 'guido@bani-vfx.com.evil']) {
    assert.equal(canAccessGeneralCash(email), false);
    assert.equal(backend.canAccessGeneralCash(email), false);
  }
});

test('un administrador excluido conserva su caja personal y no obtiene la General ni modifica fondos de ella', () => {
  const options = buildPaymentCashBoxOptions({ isProjectAdmin: true, hasPersonalCashBox: true, personalBalance: 50, currentUserEmail: 'admin@example.test', currentUserName: 'Admin' });
  assert.deepEqual(options.map(option => option.account), ['personal']);
  assert.equal(canChangePaymentCash({ cashMovementId: 'g', cashAccount: 'general' }, 'admin@example.test'), false);
  assert.equal(canChangePaymentCash({ cashAccount: 'general' }, 'admin@example.test'), false);
  assert.equal(canChangePaymentCash({ cashMovementId: 'p', cashAccount: 'personal', paidByEmail: 'admin@example.test' }, 'admin@example.test'), true);
  assert.equal(canChangePaymentCash({ cashMovementId: 'p', cashAccount: 'general' }, 'tomas@granberta.com', { cashAccount: 'personal', fromUserEmail: 'other@example.test' }), false);
});

test('el rol dueño/admin/producción por sí solo no abre Caja General en el asistente', () => {
  const project = { projectId: 'fake', projectCreatedBy: 'owner' };
  for (const email of ['info@granbertafilms.com', 'admin@example.test']) {
    const access = buildAssistantCapabilities({ ...project, userId: 'owner', userEmail: email, globalRole: 'admin' });
    assert.equal(access.isProjectAdmin, true);
    assert.equal(access.can.seeFullCash, false);
  }
  for (const email of GENERAL_CASH_EMAILS) {
    assert.equal(buildAssistantCapabilities({ ...project, userId: 'owner', userEmail: email }).can.seeFullCash, true);
    assert.equal(buildAssistantCapabilities({ ...project, userId: 'outsider', userEmail: email }).can.seeFullCash, false);
  }
  assert.equal(canReadCashMovement('admin@example.test', { toUserEmail: 'admin@example.test' }), true);
  assert.equal(canReadCashMovement('admin@example.test', { fromUserEmail: 'other@example.test' }), false);
  for (const movement of [
    { type: 'pago', cashAccount: 'general', fromUserEmail: 'admin@example.test' },
    { type: 'entrega', fromUserEmail: 'admin@example.test', toUserEmail: 'other@example.test' },
    { type: 'devolucion', fromUserEmail: 'other@example.test', toUserEmail: 'admin@example.test' },
  ]) assert.equal(canReadCashMovement('admin@example.test', movement), false);
});

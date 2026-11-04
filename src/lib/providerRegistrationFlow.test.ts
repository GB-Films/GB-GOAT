import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { providerRegistrationFailure, registrationFieldErrors, registrationNeedsVerification, verifyRegistrationSession } from './providerRegistrationFlow';
import { ProviderRegistrationFailure } from '../components/ProviderRegistrationFailure';

const now = 1_800_000_000_000;
const fresh = { auth_time:now / 1000, email:'person@example.test', email_verified:true };
const identity = { uid:'person', email:'person@example.test' };
test('stale intake pauses before any save; verifying the same account permits retry without clearing the draft', async () => {
  const draft = Object.freeze({ name:'Persona ficticia', bankAccount_alias:'cuenta.ficticia' });
  let claims = { ...fresh, auth_time:now / 1000 - 700 }, writes = 0;
  const user = { ...identity, getIdTokenResult:async () => ({ claims, signInProvider:'google.com' }) };
  const submit = async () => { await verifyRegistrationSession(() => user, identity, now); writes++; };
  await assert.rejects(submit(), (err: any) => {
    const issue = providerRegistrationFailure(err, 'attempt');
    assert.equal(issue.action, 'verify'); assert.match(issue.message, /misma cuenta/); return true;
  });
  assert.equal(writes, 0);
  claims = fresh;
  await submit(); assert.equal(writes, 1);
  assert.deepEqual(draft, { name:'Persona ficticia', bankAccount_alias:'cuenta.ficticia' });
  for (const auth_time of [0, undefined, 'invalid', now / 1000 + 100]) assert.equal(registrationNeedsVerification({ auth_time }, now), true);
});
test('account/provider/email verification is preserved before and after token refresh', async () => {
  for (const changes of [{ uid:'other' }, { email:'other@example.test' }, { claims:{ ...fresh, email_verified:false } }, { claims:{ ...fresh, email:'other@example.test' } }, { signInProvider:'password' }]) {
    const user = { ...identity, ...changes, getIdTokenResult:async () => ({ claims:fresh, signInProvider:'google.com', ...changes }) };
    await assert.rejects(verifyRegistrationSession(() => user, identity, now));
  }
  let current: any;
  current = { ...identity, getIdTokenResult:async () => { current = { ...identity, uid:'other' }; return { claims:fresh, signInProvider:'google.com' }; } };
  await assert.rejects(verifyRegistrationSession(() => current, identity, now), /account-changed/);
});
test('popup failures, connection failures and account problems each explain the next action', () => {
  for (const [code, action, message] of [
    ['auth/popup-blocked','verify',/bloqueó/], ['auth/popup-closed-by-user','verify',/cerró/], ['auth/cancelled-popup-request','verify',/abierta/],
    ['auth/user-mismatch','choose',/no coincide/], ['auth/unauthorized-domain','contact',/configurado/],
    ['auth/web-storage-unsupported','choose',/Safari o Chrome/], ['auth/network-request-failed','retry',/conexión/],
    ['functions/deadline-exceeded','retry',/sin duplicarla/], ['functions/unavailable','retry',/misma ventana/], ['functions/resource-exhausted','retry',/minutos/],
  ] as const) {
    const issue = providerRegistrationFailure({ code }, 'attempt');
    assert.equal(issue.action, action); assert.match(issue.message, message);
  }
});
test('network recovery retries the stage that failed, including login before the form exists', () => {
  for (const [phase, action] of [['load','reload'], ['signin','choose'], ['verify','verify'], ['submit','retry']] as const) {
    const failure = providerRegistrationFailure({ code:'auth/network-request-failed' }, 'attempt', phase);
    assert.equal(failure.action, action);
    if (phase !== 'submit') assert.doesNotMatch(failure.message, /Reintentar envío/);
  }
});
test('server field errors retain their field and support reference; internal and unknown errors never expose private details', () => {
  const issue = providerRegistrationFailure({ code:'functions/failed-precondition', message:'El CBU/CVU debe tener 22 números.', details:{ field:'bankAccount_cbu', supportReference:'server-ref' } }, 'local-ref');
  assert.equal(issue.field, 'bankAccount_cbu'); assert.equal(issue.reference, 'server-ref'); assert.equal(issue.action, 'fields');
  for (const code of ['functions/internal', 'functions/data-loss', 'unexpected']) {
    const failure = providerRegistrationFailure({ code, message:'PRIVATE_STACK_WITH_TOKEN', details:{ field:'role', supportReference:'https://secret.test/token' } }, 'local-ref');
    assert.doesNotMatch(JSON.stringify(failure), /PRIVATE_STACK|secret.test|role/); assert.equal(failure.action, 'contact');
  }
  const registered = providerRegistrationFailure({ code:'functions/failed-precondition', message:'Esta ficha ya tiene un alta. Ingresá a Mi proveedor con la cuenta registrada.' }, 'attempt');
  assert.equal(registered.action, 'portal');
});
test('limits match the server while formatted CBU input is measured as digits', () => {
  assert.deepEqual(registrationFieldErrors({ bankAccount_cbu:'00000031 00123456 789012', name:'Persona' }), {});
  const errors = registrationFieldErrors({ phone:'1'.repeat(61), bankAccount_alias:'a'.repeat(101) });
  assert.match(errors.phone, /Teléfono.*60/); assert.match(errors.bankAccount_alias, /Alias.*100/);
  assert.match(registrationFieldErrors({ bankAccount_cbu:'1'.repeat(23) }).bankAccount_cbu, /22/, 'an overlong pasted account is rejected instead of silently truncated');
});
test('error recovery is explicit, leaves technical reference collapsed and gives access to an existing registration', () => {
  const props = { onVerify() {}, onChoose() {}, onRetry() {}, onReload() {} };
  for (const [code, label] of [['auth/requires-recent-login','Verificar con Google'], ['auth/popup-blocked','Verificar con Google'], ['functions/unavailable','Reintentar envío']]) {
    const html = renderToStaticMarkup(createElement(ProviderRegistrationFailure, { ...props, failure:providerRegistrationFailure({ code }, 'attempt') }));
    assert.match(html, new RegExp(label)); assert.match(html, /type="button"/); assert.match(html, /<details\b/); assert.doesNotMatch(html, /<details[^>]*\bopen(?:\s|=|>)/);
  }
  const html = renderToStaticMarkup(createElement(ProviderRegistrationFailure, { ...props, failure:providerRegistrationFailure({ code:'functions/failed-precondition', message:'El alta ya se guardó. Continuá desde Mi proveedor.' }, 'attempt') }));
  assert.match(html, /href="#\/mi-proveedor"/);
});

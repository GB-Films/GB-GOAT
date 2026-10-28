import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProviderProfileForm } from '../components/ProviderProfileForm';
import { ProviderConfirmationNotice } from '../components/ProviderConfirmationNotice';
import { ProviderGoogleAccountChoice } from '../components/ProviderGoogleAccountChoice';
test('el formulario conserva valores pendientes y sustituye el titular manual por una confirmación', () => {
  const html = renderToStaticMarkup(createElement(ProviderProfileForm, {
    provider: { type: 'persona', dni: '' }, labels: { dni: 'DNI', bankAccount_holder: 'Titular manual' }, draft: {}, onChange: () => {}, busy: false, onPrepare: async () => {},
    declarations: [{ id: 'd', kind: 'profile', owned: true, status: 'pending_review', signedAt: '2026-10-28', content: { changes: { dni: { critical: true, after: '12345678' } } } }],
  }));
  assert(html.includes('value="12345678"'));
  assert(html.includes('Pendiente de revisión'));
  assert(html.includes('Soy titular de la cuenta provista'));
  assert(!html.includes('Titular manual'));
});
test('el selector muestra Google actual, avisa la diferencia y exige verificar el otro correo', () => {
  const props = { accessEmail: 'actual@example.test', registeredEmail: 'anterior@example.test', selection: { email: 'actual@example.test' }, onChange: () => {}, onVerify: async (email: string) => ({ email, verificationId: 'v' }), verifying: false, onVerifying: () => {}, error: '', onError: () => {}, disabled: false };
  const current = renderToStaticMarkup(createElement(ProviderGoogleAccountChoice, props));
  assert.match(current, /Ingresaste con Google/); assert.match(current, /Es distinto de la cuenta/);
  assert.match(current, /Usar mi cuenta actual/); assert.match(current, /Usar el correo de la ficha/);
  assert(!current.includes('Verificar con Google'));
  const other = renderToStaticMarkup(createElement(ProviderGoogleAccountChoice, { ...props, selection: { email: 'anterior@example.test' } }));
  assert.match(other, /Verificar con Google/); assert(!other.includes('Cuenta verificada con Google'));
  const verified = renderToStaticMarkup(createElement(ProviderGoogleAccountChoice, { ...props, selection: { email: 'anterior@example.test', verificationId: 'v' } }));
  assert.match(verified, /Cuenta verificada con Google/);
  const pending = renderToStaticMarkup(createElement(ProviderGoogleAccountChoice, { ...props, pendingEmail: 'nueva@example.test' }));
  assert.match(pending, /Correo solicitado/); assert.match(pending, /seguí ingresando con/); assert.match(pending, /fieldset disabled/);
});
test('el aviso pide revisar una ficha previa y desaparece cuando está confirmada o es un alta nueva', () => {
  const html = (status: string) => renderToStaticMarkup(createElement(ProviderConfirmationNotice, { status, onReview: () => {} }));
  assert.match(html('required'), /Revisá y confirmá tus datos/);
  assert.match(html('required'), /Revisar mis datos/);
  assert.match(html('pending_review'), /Tu firma quedó guardada/);
  assert.equal(html('confirmed'), '');
  assert.equal(html('not_required'), '');
});
test('la confirmación muestra la cuenta real y permite revisar sin inventar una modificación', () => {
  const html = renderToStaticMarkup(createElement(ProviderProfileForm, {
    provider: { type: 'persona', dni: '12345678', bankAccount_alias: 'mi.cuenta' }, labels: { dni: 'DNI', birthDate: 'Fecha de nacimiento' }, draft: {}, onChange: () => {}, busy: false, onPrepare: async () => {},
    declarations: [], confirmationRequired: true, accessEmail: 'persona@example.test',
  }));
  assert.match(html, /detalle completo de esta ficha/);
  assert.match(html, /persona@example.test/);
  assert.match(html, /Revisar confirmación y firmar/);
  assert.match(html, /Fecha de nacimiento/);
  assert.equal((html.match(/type="checkbox"/g) || []).length, 3);
  assert.match(html, /button disabled/);
});

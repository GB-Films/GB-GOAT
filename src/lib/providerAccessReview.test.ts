import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProviderConfirmationNotice } from '../components/ProviderConfirmationNotice';
import { providerWorkEmptyMessage } from './providerPortalUi';
test('aviso de revisión es no bloqueante, muestra campos concretos y acceso directo sin exponer banco', () => {
  const html = renderToStaticMarkup(createElement(ProviderConfirmationNotice, { status: 'required', review: { required: true, registrationPending: true, classificationPending: false, fields: [{ field: 'dni', label: 'DNI', message: 'Revisá tu DNI.' }, { field: 'bankAccount_cbu', label: 'CBU/CVU', message: 'Debe tener 22 números.' }] }, onReview() {} }));
  assert.match(html, /Tenés datos para revisar/); assert.match(html, /Podés consultar tus trabajos y comprobantes/);
  assert.match(html, /CBU\/CVU: 22 números/); assert.match(html, /Revisar mis datos/);
  assert.doesNotMatch(html, /role="dialog"|disabled|Completá.*antes de acceder/);
});
test('acceso pendiente y carga no se presentan como ausencia de trabajos', () => {
  assert.match(providerWorkEmptyMessage(true, { status: 'needs_confirmation', needsClassification: true }), /clasificación/);
  assert.match(providerWorkEmptyMessage(true, { status: 'needs_confirmation' }), /representación/);
  assert.match(providerWorkEmptyMessage(true, { status: 'active' }), /Cargando/);
  assert.match(providerWorkEmptyMessage(true, { status: 'active' }, true), /no tenés trabajos/);
  assert.match(providerWorkEmptyMessage(true), /Vinculá/);
});

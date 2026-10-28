import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProviderProfileForm } from '../components/ProviderProfileForm';
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

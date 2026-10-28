import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProviderDetailView } from './ProviderDetailView';

const detail = { provider: { id: 'provider', type: 'empresa', businessName: 'Proveedor de ejemplo', cuit: '30123456789', bankAccount_cbu: 'PRIVATE-CBU', bankAccount_alias: 'PRIVATE-ALIAS' },
  totals: { total: 300, paid: 100, debt: 200, invoices: 42, receipts: 99 }, projects: [], lines: [] };

test('asignación queda en una ventana cerrada y el encabezado conserva sólo trabajado y saldo', () => {
  const html = renderToStaticMarkup(createElement(ProviderDetailView, { detail, loading: false, onClose: () => {}, financePanel: createElement('div', null, 'FORMULARIO-DE-ASIGNACION') }));
  assert.ok(html.includes('Ficha y comprobantes'));
  assert.ok(html.includes('Asignar documentos y pagos'));
  assert.ok(html.includes('Trabajado'));
  assert.ok(html.includes('Saldo'));
  assert.doesNotMatch(html, /<dt[^>]*>Pagado|>Facturas<|>Comprobantes</);
  const assignment = html.slice(html.indexOf('<dialog', html.indexOf('<dialog') + 1));
  assert.ok(assignment.includes('FORMULARIO-DE-ASIGNACION'));
  assert.doesNotMatch(assignment.slice(0, assignment.indexOf('>')), /\bopen\b/);
});

test('sin gestión no ofrece asignación y el modo restringido oculta CBU y alias', () => {
  const html = renderToStaticMarkup(createElement(ProviderDetailView, { detail, loading: false, onClose: () => {}, canSeeBankDetails: false }));
  assert.doesNotMatch(html, /Asignar documentos y pagos|PRIVATE-CBU|PRIVATE-ALIAS/);
  assert.ok(html.includes('30-12345678-9'));
});

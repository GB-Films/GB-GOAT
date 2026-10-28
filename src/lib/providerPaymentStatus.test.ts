import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { invoicePaymentAppearance, filterProviderBalances } from './providerPaymentStatus';
import { ProjectProvidersView, type ProjectProviderBalance } from '../pages/project-detail/ProjectProvidersView';
import { ProjectProviderDetails } from '../pages/project-detail/ProjectProviderDetails';

test('color de factura depende de pagos reales: pendiente, parcial, saldada o con sobrepago', () => {
  assert.match(invoicePaymentAppearance(100, 0).className, /rose/);
  assert.match(invoicePaymentAppearance(100, 40).className, /amber/);
  assert.match(invoicePaymentAppearance(100, 100).className, /emerald/);
  assert.equal(invoicePaymentAppearance(100, 120).status, 'pagado');
});

test('combina proveedor y estado, ignora conceptos y conserva las áreas visibles de entrada', () => {
  const groups = [{ area: 'Arte', rows: [
    { name: 'Sofía López', debt: 60, paid: 40, description: 'Catering' },
    { name: 'Catering Sur', debt: 0, paid: 100, description: 'Sofía' },
  ] }];
  assert.deepEqual(filterProviderBalances(groups, ' SOFIA ', 'parcial')[0].rows.map(row => row.name), ['Sofía López']);
  assert.equal(filterProviderBalances(groups, 'Sofía', 'pagado').length, 0);
  assert.equal(filterProviderBalances(groups, 'Catering', 'all')[0].rows.length, 1);
  assert.equal(groups[0].rows.length, 2);
});

test('detalle conserva todas las facturas y comprobantes, ofrece historial sin duplicar cartel Pagado y oculta CBU a no admins', () => {
  const row: ProjectProviderBalance = { id: 'row', area: 'Arte', name: 'Proveedor de ejemplo', provider: { id: 'provider' }, cuit: '', cbu: 'SECRET-CBU', budgeted: 100, spent: 100, paid: 100, debt: 0,
    entries: [{ id: 'expense', collectionName: 'areaExpenses', description: 'Servicio', total: 100, paid: 100,
      invoices: [{ url: 'https://example.test/invoice-one.pdf' }, { url: 'https://example.test/invoice-two.pdf' }],
      item: { paymentHistory: [{ receipt: { url: 'https://example.test/receipt.pdf' } }] } }] };
  const html = renderToStaticMarkup(createElement(ProjectProvidersView, { groups: [{ area: 'Arte', rows: [row] }], totalRows: 1, search: '', onSearchChange: () => {}, status: 'all', onStatusChange: () => {}, isProjectAdmin: false,
    canManagePaymentForItem: () => true, openPaymentModal: () => {}, formatDate: () => '', paymentTiming: () => '' }));
  for (const path of ['invoice-one.pdf', 'invoice-two.pdf', 'receipt.pdf']) assert.ok(html.includes(path));
  assert.ok(html.includes('Ver pagos'));
  assert.ok(html.includes('Ver datos completos del proveedor'));
  assert.ok(!html.includes('SECRET-CBU'));
  assert.doesNotMatch(html, /<button[^>]*>Pagado<\/button>|>Pagado<\/span>/);
  assert.equal((html.match(/<select /g) || []).length, 1);
});

test('ficha completa mantiene datos de contacto y protege datos bancarios según el acceso del proyecto', () => {
  const provider = { name: 'Persona', lastName: 'Ejemplo', type: 'persona', email: 'persona@example.test', bankAccount_cbu: 'SECRET-CBU', bankAccount_alias: 'SECRET-ALIAS' };
  const publicHtml = renderToStaticMarkup(createElement(ProjectProviderDetails, { provider, canSeeBankDetails: false, onClose: () => {} }));
  assert.ok(publicHtml.includes('persona@example.test'));
  assert.doesNotMatch(publicHtml, /SECRET-CBU|SECRET-ALIAS/);
  assert.ok(renderToStaticMarkup(createElement(ProjectProviderDetails, { provider, canSeeBankDetails: true, onClose: () => {} })).includes('SECRET-CBU'));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProjectProvidersView } from '../pages/project-detail/ProjectProvidersView';

const group = { area: 'Arte', rows: [{ id: 'supplier', provider: null, area: 'Arte', name: 'Proveedor ficticio', cuit: '', cbu: '',
  budgeted: 100, spent: 100, paid: 40, debt: 60, entries: [{ id: 'row', collectionName: 'areaExpenses' as const,
    item: { id: 'row', area: 'Arte', paymentHistory: [{ id: 'admin-payment', amount: 40, createdBy: 'other-admin', receipt: { url: 'https://example.test/payment.pdf' } }] },
    description: 'Trabajo ficticio', total: 100, paid: 40, invoices: [] }] }] };
function render(canView: boolean, canManage: boolean) {
  return renderToStaticMarkup(createElement(ProjectProvidersView, { groups: [group], totalRows: 1, search: '', status: 'all',
    onSearchChange: () => {}, onStatusChange: () => {}, isProjectAdmin: false,
    canViewPaymentForItem: () => canView, canManagePaymentForItem: () => canManage, openPaymentModal: () => {}, formatDate: () => '', paymentTiming: () => '' }));
}
test('un lector del área ve pagos y comprobantes de otro autor sin opción de registrar pagos', () => {
  const html = render(true, false);
  assert.match(html, /Ver pagos/);
  assert.match(html, /https:\/\/example\.test\/payment\.pdf/);
  assert.doesNotMatch(html, /Registrar pago/);
});
test('el acceso de lectura controla también los enlaces de originales', () => {
  const html = render(false, true);
  assert.doesNotMatch(html, /Ver pagos|Registrar pago|https:\/\/example\.test\/payment\.pdf/);
});
test('un editor conserva la opción de registrar cuando queda saldo', () => {
  assert.match(render(true, true), /Registrar pago/);
});

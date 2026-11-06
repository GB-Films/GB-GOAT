import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InvoiceContext, SharedExpenseInvoices } from '../components/SharedExpenseInvoices';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { BudgetRowCell } from '../pages/project-detail/BudgetRowCell';
const scope = { projectId: 'project-a', collectionName: 'areaExpenses', itemId: 'row' };
const record = { id: 'invoice', kind: 'invoice', status: 'active', issuerCuit: '27333333334', file: { fileName: 'third-party.pdf' }, allocations: [scope], distinctExpenseCount: 1 };
function html(records = [record], providerCuit = '20111111112') {
  return renderToStaticMarkup(createElement(InvoiceContext.Provider, { value: {
    records: new Map(records.map(row => [row.id, row])), providers: new Map([['provider', { cuit: providerCuit }]]), loading: false, reload() {},
  } }, createElement(SharedExpenseInvoices, { item: { providerId: 'provider', sharedInvoices: records.map(row => ({ id: row.id })) }, scope })));
}
test('one-row third-party invoice uses the document icon with yellow fill, green border and accessible tooltip; multi-row still opens the profile', () => {
  const single = html();
  assert.match(single, /aria-label="Factura de tercero"/); assert.match(single, /title="Factura de tercero/);
  assert.match(single, /lucide-file-text/); assert.match(single, /bg-amber-100/); assert.match(single, /border-emerald-500/);
  assert.doesNotMatch(single, /en la ficha del proveedor/);
  const multiple = html([{ ...record, distinctExpenseCount: 2 }]);
  assert.match(multiple, /en la ficha del proveedor/); assert.match(multiple, /2 filas/);
  const own = html([record], record.issuerCuit);
  assert.doesNotMatch(own, /Factura de tercero|border-amber/); assert.match(own, /border-emerald/);
});
test('each original has a separate control and missing files produce honest feedback', () => {
  const separate = html([record, { ...record, id: 'second' }]);
  assert.equal((separate.match(/<button /g) || []).length, 2);
  assert.match(separate, /1: third-party.pdf/); assert.match(separate, /2: third-party.pdf/);
  const missing = html([{ ...record, file: undefined }]);
  assert.match(missing, /no tiene un archivo disponible/);
  assert.doesNotMatch(missing, /href=|en la ficha del proveedor/);
});
test('the provider cell does not duplicate the invoice and only links an actual payment document', () => {
  const provider = { id: 'provider', type: 'persona', name: 'Persona ficticia', cuit: '20111111112', source: 'provider_invite' };
  const item = { id: 'row', providerId: provider.id, providerName: provider.name, thirdPartyPayoutRequired: true, sharedInvoices: [{ id: 'invoice' }], sharedPaymentIds: ['payment'] };
  function cell(paymentFile: boolean) {
    return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/proyectos/project-a'] },
      createElement(InvoiceContext.Provider, { value: { records: new Map([['payment', { ...record, id: 'payment', kind: 'payment', file: paymentFile ? record.file : undefined }]]), providers: new Map([[provider.id, provider]]), loading: false, reload() {} } },
        createElement(Routes, null, createElement(Route, { path: '/proyectos/:id', element: createElement(BudgetRowCell, {
          item, providers: [provider], collectionName: 'areaExpenses', type: 'provider', onUpdate: async () => {},
        }) })))));
  }
  const noFile = cell(false);
  assert.doesNotMatch(noFile, /Factura de tercero|Comprobantes \/ pago vinculado/);
  assert.match(noFile, /Facturación y cobro por tercero/, 'the distinct authorization access remains available');
  assert.match(cell(true), /Comprobantes \/ pago vinculado/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InvoiceContext, SharedExpenseInvoices } from '../components/SharedExpenseInvoices';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { BudgetRowCell } from '../pages/project-detail/BudgetRowCell';
import { ExpenseInvoiceCell } from '../pages/project-detail/ExpenseFileCells';
import { ExpenseDocumentsPanel } from '../pages/project-detail/MobileExpenseDocuments';
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
test('the provider cell only adds a link for multi-row documents, regardless of third-party status', () => {
  const provider = { id: 'provider', type: 'persona', name: 'Persona ficticia', cuit: '20111111112', source: 'provider_invite' };
  const item = { id: 'row', providerId: provider.id, providerName: provider.name, thirdPartyPayoutRequired: true, sharedInvoices: [{ id: 'invoice' }], sharedPaymentIds: ['payment'] };
  function cell(paymentFile: boolean, distinctExpenseCount: number | null = 1, thirdParty = true) {
    return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/proyectos/project-a'] },
      createElement(InvoiceContext.Provider, { value: { records: new Map([['payment', { ...record, id: 'payment', kind: 'payment', distinctExpenseCount, file: paymentFile ? record.file : undefined }]]), providers: new Map([[provider.id, provider]]), loading: false, reload() {} } },
        createElement(Routes, null, createElement(Route, { path: '/proyectos/:id', element: createElement(BudgetRowCell, {
          item: { ...item, thirdPartyPayoutRequired: thirdParty }, providers: [provider], collectionName: 'areaExpenses', type: 'provider', onUpdate: async () => {},
        }) })))));
  }
  const noFile = cell(false);
  assert.doesNotMatch(noFile, /Factura de tercero|Comprobantes \/ pago vinculado/);
  assert.match(noFile, /Facturación y cobro por tercero/, 'the distinct authorization access remains available');
  for (const thirdParty of [false, true]) {
    assert.doesNotMatch(cell(true, 1, thirdParty), /Comprobantes \/ pago vinculado/);
    assert.doesNotMatch(cell(true, null, thirdParty), /Comprobantes \/ pago vinculado/);
    assert.doesNotMatch(cell(false, 2, thirdParty), /Comprobantes \/ pago vinculado/);
    assert.match(cell(true, 2, thirdParty), /Comprobantes \/ pago vinculado/);
  }
});

test('third-party documents keep the same upload, link and removal controls in desktop and mobile views', () => {
  const item = { id: 'row', providerId: 'provider', thirdPartyPayoutRequired: true, sharedInvoices: [{ id: record.id }] };
  const props = { item, scope, canManage: true, canRemove: true, uploadingInvoice: false, uploadingReceipt: false, generatingLink: false,
    onUploadInvoice() {}, onUploadReceipt() {}, onRemoveInvoice() {}, onRemoveReceipt() {}, onRemoveSharedInvoice() {}, onCreateInvoiceLink() {} };
  const render = (child: any) => renderToStaticMarkup(createElement(InvoiceContext.Provider, { value: { records: new Map([[record.id, record]]), providers: new Map([['provider', { cuit: '20111111112' }]]), loading: false, reload() {} } }, child));
  const desktop = render(createElement(ExpenseInvoiceCell, props));
  assert.match(desktop, /border-emerald-500/); assert.match(desktop, /bg-amber-100/);
  assert.match(desktop, /Quitar factura de este gasto/);
  assert.match(desktop, /Adjuntar otra factura/);
  assert.match(desktop, /Copiar link para que el proveedor cargue su factura/);
  assert.match(desktop, /type="file"/);
  const readonly = render(createElement(ExpenseInvoiceCell, { ...props, canManage: false, canRemove: false }));
  assert.doesNotMatch(readonly, /Quitar factura|type="file"|Copiar link/);
  const mobile = render(createElement(ExpenseDocumentsPanel, props));
  assert.match(mobile, /Quitar factura de este gasto/); assert.match(mobile, /Copiar link de carga/); assert.match(mobile, /type="file"/);
  const additional = { id: 'extra', url: 'https://example.test/extra.pdf', fileName: 'extra.pdf' };
  const multiple = render(createElement(ExpenseInvoiceCell, { ...props, item: { ...item, invoices: [additional] } }));
  assert.match(multiple, /Ver 2 facturas/); assert.match(multiple, /Adjuntar otra factura/); assert.match(multiple, /Copiar link/);
  const removed = render(createElement(ExpenseInvoiceCell, { ...props, item: { ...item, sharedInvoices: [{ id: record.id, fileHidden: true }] } }));
  assert.doesNotMatch(removed, /Quitar factura de este gasto/); assert.match(removed, /Adjuntar factura/); assert.match(removed, /Copiar link/);
});

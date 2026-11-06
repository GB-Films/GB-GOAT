import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InvoiceContext, SharedExpenseInvoices } from '../components/SharedExpenseInvoices';
const scope = { projectId: 'project-a', collectionName: 'areaExpenses', itemId: 'row' };
const record = { id: 'invoice', kind: 'invoice', status: 'active', issuerCuit: '27333333334', file: { fileName: 'third-party.pdf' }, allocations: [scope], distinctExpenseCount: 1 };
function html(records = [record], providerCuit = '20111111112') {
  return renderToStaticMarkup(createElement(InvoiceContext.Provider, { value: {
    records: new Map(records.map(row => [row.id, row])), providers: new Map([['provider', { cuit: providerCuit }]]), loading: false, reload() {},
  } }, createElement(SharedExpenseInvoices, { item: { providerId: 'provider', sharedInvoices: records.map(row => ({ id: row.id })) }, scope })));
}
test('one-row third-party invoice is an amber bordered file button; multi-row uses the profile launcher', () => {
  const single = html();
  assert.match(single, /Factura de tercero/); assert.match(single, /border-amber-400/);
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

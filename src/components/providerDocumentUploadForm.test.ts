import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProviderDocumentUploadForm } from './ProviderDocumentUploadForm';
test('invoice and receipt uploads offer a drop zone and projects without fiscal or bank fields', () => {
  const lines = [{ projectId: 'one', projectName: 'Proyecto pendiente', collectionName: 'areaExpenses', expenseId: 'one', total: 100, item: {} },
    { projectId: 'billed', projectName: 'Proyecto facturado', collectionName: 'areaExpenses', expenseId: 'billed', total: 100, item: { invoice: { path: 'legacy' } } }];
  for (const kind of ['invoice', 'other'] as const) {
    const html = renderToStaticMarkup(createElement(ProviderDocumentUploadForm, { kind, lines, onClose: () => {}, onSave: async () => {} }));
    assert.match(html, /Arrastrá el documento acá/); assert.match(html, /Seleccionar archivo/); assert.match(html, /Proyecto pendiente/); assert.match(html, /Cancelar/);
    assert.doesNotMatch(html, /CUIT|Emisor fiscal|Cotización|Neto del costo|Total fiscal|type="date"|textarea/);
    if (kind === 'invoice') assert.doesNotMatch(html, /Proyecto facturado/); else assert.match(html, /Proyecto facturado/);
  }
});

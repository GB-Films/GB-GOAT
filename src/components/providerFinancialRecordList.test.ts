import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProviderFinancialRecordList } from './ProviderFinancialRecordList';

test('facturas y pagos muestran los proyectos debajo, agrupan gastos y reservan notas y anulación para Detalle', () => {
  const record = { id: 'invoice', kind: 'invoice', status: 'active', number: 'C 123', date: '2026-10-21', totalCents: 60000, netArsCents: 60000, currency: 'ARS', file: {}, notes: 'NOTA OPERATIVA EXTENSA', allocations: [
    { projectId: 'one', projectName: 'Primer proyecto', amountCents: 10000 },
    { projectId: 'one', projectName: 'Primer proyecto', amountCents: 20000 },
    { projectId: 'two', projectName: 'Segundo proyecto', amountCents: 30000 },
  ] };
  const html = renderToStaticMarkup(createElement(ProviderFinancialRecordList, { records: [record, { ...record, id: 'payment', kind: 'payment' }], onOpen: async () => {}, onCancel: async () => {} }));
  assert.equal((html.match(/href="#\/proyectos\/one"/g) || []).length, 2);
  assert.equal((html.match(/>\$300,00</g) || []).length, 4);
  assert.equal((html.match(/Proyectos incluidos/g) || []).length, 2);
  assert.equal((html.match(/Abrir archivo/g) || []).length, 2);
  assert.match(html, /21\/10\/2026/);
  const details = [...html.matchAll(/<details[^>]*>([\s\S]*?)<\/details>/g)];
  assert.equal(details.length, 2);
  for (const match of details) { assert.match(match[1], /NOTA OPERATIVA EXTENSA/); assert.match(match[1], /Anular/); assert.doesNotMatch(match[0].slice(0, match[0].indexOf('>')), /open/); }
});

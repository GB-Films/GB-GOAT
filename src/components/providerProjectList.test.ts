import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProviderProjectList } from './ProviderProjectList';

const projects = [
  { id: 'one', name: 'Proyecto Uno', total: 3000, paid: 1000, debt: 2000, invoices: 1, receipts: 1 },
  { id: 'two', name: 'Proyecto Dos', total: 500, paid: 500, debt: 0, invoices: 0, receipts: 0 },
];
const lines = [
  { id: 'a', projectId: 'one', area: 'Producción', source: 'Gestion por Areas', description: 'Servicio Uno', total: 1000, paid: 1000, debt: 0,
    payments: [{ id: 'pay', amount: 1000, date: '2026-10-22T17:13:00Z', loadedBy: 'Administración', detail: 'Transferencia confirmada' }],
    invoiceDocuments: [{ path: 'invoice', url: 'https://example.test/invoice', fileName: 'Factura.pdf' }],
    paymentReceiptDocuments: [{ path: 'payment', url: 'https://example.test/payment', fileName: 'Pago.pdf' }] },
  { id: 'b', projectId: 'one', area: 'Arte', source: 'Presupuesto Principal', description: 'Servicio Dos', total: 2000, paid: 0, debt: 2000, payments: [], paymentDate: '2026-10-30' },
  { id: 'c', projectId: 'two', area: 'Producción', source: 'Reintegro a tercero', description: 'Reintegro de traslado', total: 500, paid: 500, debt: 0, payments: [] },
];

test('una sola lista agrupa gastos, pagos y documentos bajo su proyecto sin repetir enlaces', () => {
  const before = JSON.stringify({ projects, lines });
  const html = renderToStaticMarkup(createElement(ProviderProjectList, { projects, lines }));
  assert.equal((html.match(/class="group\/project\b/g) || []).length, 2);
  assert.doesNotMatch(html, /<details[^>]*\bopen\b/);
  const first = html.slice(html.indexOf('<details'), html.indexOf('Proyecto Dos'));
  assert.match(first, /Servicio Uno/);
  assert.match(first, /Servicio Dos/);
  assert.doesNotMatch(first, /Reintegro de traslado/);
  assert.match(first, /22\/10\/2026/);
  assert.match(first, /Transferencia confirmada/);
  assert.match(first, /Fecha prevista: 30\/10\/2026/);
  assert.equal((html.match(/href="https:\/\/example.test\/invoice"/g) || []).length, 1);
  assert.equal((html.match(/href="https:\/\/example.test\/payment"/g) || []).length, 1);
  assert.equal(JSON.stringify({ projects, lines }), before);
});

test('un proyecto con un gasto muestra sus totales una sola vez', () => {
  const html = renderToStaticMarkup(createElement(ProviderProjectList, { projects: [projects[1]], lines: [lines[2]] }));
  assert.equal((html.match(/>Trabajado /g) || []).length, 1);
  assert.match(html, /Reintegro de traslado/);
  assert.match(html, /Sin comprobantes/);
  assert.doesNotMatch(html, />Importe<|>Pagado<|>Saldo</);
});

test('la ficha abre sólo el proyecto de origen y mantiene la misma grilla en proyectos con uno o varios gastos', () => {
  const html = renderToStaticMarkup(createElement(ProviderProjectList, { projects, lines, initialProjectId: 'two' }));
  assert.equal((html.match(/<details[^>]*open=""/g) || []).length, 1);
  assert.match(html, /<details[^>]*open=""[^>]*>[\s\S]*Proyecto Dos/);
  const grids = [...html.matchAll(/<colgroup>(.*?)<\/colgroup>/g)].map(match => match[1]);
  assert.equal(grids.length, 2);
  assert.equal(grids[0], grids[1]);
});

test('el comprobante compartido se ofrece en cada proyecto y no genera enlaces públicos nuevos', () => {
  const sharedDocuments = [{ id: 'one-invoice', kind: 'invoice' as const, name: 'C 0001-98' }];
  const html = renderToStaticMarkup(createElement(ProviderProjectList, { projects, lines: lines.map(line => ({ ...line, sharedDocuments })), onOpenSharedDocument: async () => {} }));
  assert.equal((html.match(/aria-label="Abrir C 0001-98"/g) || []).length, 3);
  assert.doesNotMatch(html, /href="[^\"]*one-invoice|providerFinance\//);
});

test('sin proyectos conserva el estado vacío', () => {
  const html = renderToStaticMarkup(createElement(ProviderProjectList, { projects: [], lines: [] }));
  assert.match(html, /Sin movimientos visibles/);
  assert.doesNotMatch(html, /<details/);
});

test('fechas Timestamp, Date y valores heredados no rompen la ficha del proveedor', () => {
  const at = new Date('2026-10-22T15:00:00Z');
  const values: unknown[] = [
    { seconds: at.getTime() / 1000, nanoseconds: 0 },
    { toDate: () => at }, at, at.getTime(),
    {}, { seconds: 'incorrecto' }, new Date(NaN),
    { toDate: () => { throw new Error('Fecha inválida'); } },
  ];
  for (const [index, value] of values.entries()) {
    const html = renderToStaticMarkup(createElement(ProviderProjectList, {
      projects: [projects[0]],
      lines: [{ ...lines[0], payments: [{ id: 'pay', amount: 1000, date: value }] },
        { ...lines[1], paymentDate: value }],
    }));
    assert.match(html, /Servicio Uno/);
    assert.match(html, /Servicio Dos/);
    assert.match(html, index < 4 ? /22\/10\/2026/ : /Sin fecha/);
    assert.doesNotMatch(html, /\[object Object\]|Invalid Date/);
  }
});

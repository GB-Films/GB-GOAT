import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProviderInvoiceList } from '../components/ProviderInvoiceList';
import { ProviderAdvanceCards } from '../components/ProviderReimbursements';
test('only a server-authorized own invoice exposes removal; producer files remain download only', () => {
  const base = { providerId: 'p', work: { key: 'project/areaExpenses/e', projectName: 'Proyecto', description: 'Trabajo', invoiceCount: 1,
    invoices: [{ index: 0, fileName: 'factura.pdf', canRemove: false }] }, busy: false, onDownload: () => {}, onChanged: async () => {} };
  assert(!renderToStaticMarkup(createElement(ProviderInvoiceList, base)).includes('Eliminar mi factura'));
  const html = renderToStaticMarkup(createElement(ProviderInvoiceList, { ...base, work: { ...base.work, invoices: [{ index: 0, canRemove: true, uploadId: 'own', revision: 1 }] } }));
  assert.match(html, /Eliminar mi factura/); assert.match(html, /type="button"/);
});
test('payer cards separate advanced, reimbursed and outstanding amounts; refunds start collapsed and missing files have no link', () => {
  const html = renderToStaticMarkup(createElement(ProviderAdvanceCards, { busy: false, onDownload: () => {}, advances: [{
    key: 'a', workKey: 'p/areaExpenses/e', projectName: 'Proyecto', description: 'Gasto adelantado', currency: 'ARS', paymentIndex: 0, paymentVersion: 'version',
    date: '2026-11-04', amount: 100, reimbursed: 25, balance: 75, hasReceipt: false,
    reimbursements: [{ id: 'r', index: 0, amount: 25, date: '2026-11-04', detail: 'Parcial', hasReceipt: false }],
  }] }));
  for (const label of ['Adelantaste', 'Te devolvieron', 'Falta devolver', 'Reintegro pendiente', 'Devoluciones recibidas']) assert(html.includes(label));
  assert(!/<details[^>]*\sopen/.test(html)); assert(!html.includes('Comprobante'));
});

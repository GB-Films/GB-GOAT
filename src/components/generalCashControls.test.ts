import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProviderPaymentForm } from './ProviderPaymentForm';
import { ProviderFinancialRecordList } from './ProviderFinancialRecordList';

test('un usuario sin permiso General conserva el comprobante de pago y no recibe la opción de efectivo General', () => {
  const props = { provider: { name: 'Ficticio' }, lines: [{ projectId: 'fake', projectName: 'Ficticio', collectionName: 'areaExpenses', expenseId: 'work', description: 'Ficticio', debt: 100 }], invoices: [], busy: false, uncertain: false, onClose() {}, async onSave() {} };
  const limited = renderToStaticMarkup(createElement(ProviderPaymentForm, props));
  assert.match(limited, /Comprobante de pago/);
  assert.doesNotMatch(limited, /Efectivo|Caja General/);
  assert.match(renderToStaticMarkup(createElement(ProviderPaymentForm, { ...props, canUseGeneralCash: true })), /Efectivo/);
});

test('el comprobante compartido conserva lectura pero su anulación de efectivo requiere permiso General', () => {
  const props = { records: [{ id: 'cash', kind: 'payment', method: 'cash', status: 'active', date: '2026-11-05', currency: 'ARS', totalCents: 10000, netArsCents: 10000, allocations: [], file: { fileName: 'ficticio.pdf' } }], async onOpen() {}, async onCancel() {} };
  const limited = renderToStaticMarkup(createElement(ProviderFinancialRecordList, props));
  assert.match(limited, /Abrir archivo/);
  assert.doesNotMatch(limited, /Anular/);
  assert.match(renderToStaticMarkup(createElement(ProviderFinancialRecordList, { ...props, canCancelGeneralCash: true })), /Anular/);
});

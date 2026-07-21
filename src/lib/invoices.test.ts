import assert from 'node:assert/strict';
import test from 'node:test';
import { getExpenseInvoices, getPrimaryExpenseInvoice } from './invoices';

test('mantiene compatibilidad con una factura legacy', () => {
  const invoice = { path: 'legacy.pdf', url: 'https://example.com/legacy.pdf' };
  assert.deepEqual(getExpenseInvoices({ invoice }), [invoice]);
  assert.equal(getPrimaryExpenseInvoice({ invoice }), invoice);
});

test('combina la factura legacy con nuevos documentos sin duplicarla', () => {
  const legacy = { path: 'legacy.pdf', url: 'https://example.com/legacy.pdf' };
  const second = { path: 'second.pdf', url: 'https://example.com/second.pdf' };
  assert.deepEqual(getExpenseInvoices({ invoice: legacy, invoices: [legacy, second] }), [legacy, second]);
});

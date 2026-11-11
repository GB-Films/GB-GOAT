import test from 'node:test';
import assert from 'node:assert/strict';
import { expenseLinkedRecordIds, hasLinkedExpenseFile, isThirdPartyInvoice, projectInvoiceRelationsKey, sharedInvoiceAction, sharedInvoiceReferences, type InvoiceRecord } from './sharedExpenseInvoices';
const scope = { projectId: 'project-a', collectionName: 'areaExpenses', itemId: 'row' };
const invoice: InvoiceRecord = { id: 'invoice', kind: 'invoice', status: 'active', number: 'C 0001-123', issuerCuit: '27333333334', file: { fileName: 'original.pdf' }, distinctExpenseCount: 1, allocations: [scope] };
test('one distinct expense downloads its native original; only multi-row invoices open the profile', () => {
  assert.equal(sharedInvoiceAction(invoice, scope), 'file');
  assert.equal(sharedInvoiceAction({ ...invoice, allocations: [scope, scope] }, scope), 'file');
  assert.equal(sharedInvoiceAction({ ...invoice, distinctExpenseCount: 2 }, scope), 'profile', 'the other row can belong to another project and be omitted from this projection');
  assert.equal(sharedInvoiceAction({ ...invoice, distinctExpenseCount: undefined }, scope), 'unknown', 'one scoped allocation is never treated as the global count');
});
test('third-party styling requires the invoice issuer CUIT and the actual worker CUIT, not a payment flag or name', () => {
  assert.equal(isThirdPartyInvoice(invoice, '20-11111111-2'), true);
  assert.equal(isThirdPartyInvoice(invoice, '27-33333333-4'), false);
  assert.equal(isThirdPartyInvoice({ issuerCuit: '' }, '20111111112'), false);
  assert.equal(isThirdPartyInvoice(invoice, ''), false);
  assert.equal(isThirdPartyInvoice({ issuerCuit: '27333333334' }, 'EIN 12-3456789'), false);
  const otherPayee = { issuerCuit: '20111111112', payeeCuit: '27333333334', thirdPartyPayoutRequired: true };
  assert.equal(isThirdPartyInvoice(otherPayee, '20111111112'), false, 'a third-party payee does not turn an own invoice into a third-party invoice');
});
test('missing files, retired records, unknown counts and a different expense never open another record', () => {
  assert.equal(sharedInvoiceAction({ ...invoice, file: undefined }, scope), 'missing-file');
  assert.equal(sharedInvoiceAction(undefined, scope), 'unavailable');
  assert.equal(sharedInvoiceAction({ ...invoice, status: 'cancelled' }, scope), 'unavailable');
  assert.equal(sharedInvoiceAction(invoice, { ...scope, itemId: 'foreign' }), 'unavailable');
  assert.equal(sharedInvoiceAction(invoice, null), 'unavailable');
  assert.equal(sharedInvoiceAction({ ...invoice, kind: 'payment' }, scope), 'unavailable');
});
test('several invoices remain separate; repeated references to the same original do not hide other files', () => {
  const rows = sharedInvoiceReferences({ sharedInvoices: [{ id: 'first' }, { id: 'first' }, { id: 'second' }] });
  assert.deepEqual(rows.map(row => row.id), ['first', 'second']);
});
test('linking the same invoice to a second row invalidates its project cache even though the ID set is unchanged', () => {
  const first = { id: 'row', __invoiceCollectionName: 'areaExpenses', sharedInvoices: [{ id: 'invoice' }] };
  const second = { ...first, id: 'second' };
  assert.notEqual(projectInvoiceRelationsKey([first]), projectInvoiceRelationsKey([first, second]));
  assert.notEqual(projectInvoiceRelationsKey([first]), projectInvoiceRelationsKey([{ ...first, __invoiceCollectionName: 'budgetItems' }]));
  assert.equal(projectInvoiceRelationsKey([first, second]), projectInvoiceRelationsKey([second, first]), 'reordering rows does not refetch metadata');
});
test('payment IDs without a file do not create a document link; actual receipts and payments keep their scoped access', () => {
  const item = { sharedInvoices: [{ id: 'invoice' }], sharedPaymentIds: ['payment'], sharedReceipts: [{ id: 'receipt' }] };
  const records = new Map<string, InvoiceRecord>([['invoice', invoice]]);
  assert.equal(hasLinkedExpenseFile(item, records, scope), false);
  records.set('payment', { ...invoice, id: 'payment', kind: 'payment', file: undefined });
  assert.equal(hasLinkedExpenseFile(item, records, scope), false, 'cash or a payment without an original is not a downloadable document');
  records.set('payment', { ...invoice, id: 'payment', kind: 'payment' });
  assert.equal(hasLinkedExpenseFile(item, records, scope), true);
  assert.equal(hasLinkedExpenseFile(item, records, { ...scope, itemId: 'other' }), false);
  records.set('payment', { ...invoice, id: 'payment', kind: 'payment', status: 'cancelled' });
  assert.equal(hasLinkedExpenseFile(item, records, scope), false);
  records.set('receipt', { ...invoice, id: 'receipt', kind: 'other' });
  assert.equal(hasLinkedExpenseFile(item, records, scope), true);
  assert.equal(hasLinkedExpenseFile({ sharedInvoices: [{ id: 'receipt' }] }, records, scope), false, 'an invoice reference cannot become a receipt link');
});
test('the existing batched document lookup and cache key include receipts and payments, not just invoices', () => {
  const row = { id: 'row', __invoiceCollectionName: 'areaExpenses', sharedInvoices: [{ id: 'invoice' }] };
  const linked = { ...row, sharedReceipts: [{ id: 'receipt' }], sharedPaymentIds: ['payment', 'payment'] };
  assert.deepEqual(expenseLinkedRecordIds(linked), ['invoice', 'receipt', 'payment']);
  assert.notEqual(projectInvoiceRelationsKey([row]), projectInvoiceRelationsKey([linked]));
});

test('removing a native file from this row hides its control without rewriting the fiscal reference', () => {
  const reference = { id: 'invoice', amountCents: 10000, issuerCuit: invoice.issuerCuit };
  const hidden = { ...reference, fileHidden: true };
  assert.deepEqual(sharedInvoiceReferences({ sharedInvoices: [reference, hidden] }), [reference]);
  assert.deepEqual(sharedInvoiceReferences({ sharedInvoices: [hidden] }), []);
  assert.equal(hidden.id, reference.id); assert.equal(hidden.amountCents, reference.amountCents);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { invoiceFile } = require('./providerPortalInvoice');
const { ownExpense } = require('./providerPortalModel');
test('invoice validation checks real bytes and keeps the 2 MB limit', () => {
  assert.equal(invoiceFile({ base64: Buffer.from('%PDF-fixture').toString('base64'), contentType: 'application/pdf' }).sha256.length, 64);
  for (const file of [null, { base64: 'a', contentType: 'text/html' }, { base64: Buffer.from('not PDF').toString('base64'), contentType: 'application/pdf' },
    { base64: Buffer.alloc(2097153).toString('base64'), contentType: 'application/pdf' }]) assert.throws(() => invoiceFile(file));
});
test('work invoice availability includes legacy, array and shared invoices without exposing their tokens', () => {
  for (const record of [{ invoice: { url: 'private' } }, { invoices: [{ path: 'private' }] }, { sharedInvoices: [{ id: 'shared', amountCents: 100 }] }]) {
    const result = ownExpense({ area: 'Campo', ...record }, { activeAreas: ['Campo'] }, 'projects/p/areaExpenses/e');
    assert.equal(result.hasInvoice, true); assert(!JSON.stringify(result).includes('private'));
  }
  assert.equal(ownExpense({ area: 'Campo' }, { activeAreas: ['Campo'] }, 'projects/p/areaExpenses/e').hasInvoice, false);
});

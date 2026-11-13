const test = require('node:test');
const assert = require('node:assert/strict');
const { cashParts, cashPayment, createCashReceiptService } = require('./providerCashReceipts');
const { cashReceiptPdf } = require('./providerCashReceiptPdf');
const { PDFDocument } = require('pdf-lib');

const item = { providerId: 'supplier', description: 'Servicio de prueba', paymentHistory: [{ id: 'payment', amount: 1500, date: '2026-11-13', method: 'caja_efectivo', cashAccount: 'personal', cashMovementId: 'cash', createdBy: 'operator', createdByEmail: 'operator@example.test' }] };
test('receipt denomination uses exact accounting cents for ARS, USD and mixed cash', () => {
  assert.deepEqual(cashParts({ ars: 1500, usd: 0, rate: 0 }, 150000), { arsCents: 150000, usdCents: 0, rate: 0 });
  assert.deepEqual(cashParts({ ars: 0, usd: 1, rate: 1500 }, 150000), { arsCents: 0, usdCents: 100, rate: 1500 });
  assert.deepEqual(cashParts({ ars: 500, usd: 1, rate: 1000 }, 150000), { arsCents: 50000, usdCents: 100, rate: 1000 });
  for (const parts of [{ ars: 0, usd: 0, rate: 0 }, { ars: 1499, usd: 0, rate: 0 }, { ars: 1501, usd: 0, rate: 0 }, { ars: 0, usd: 1, rate: 0 }, { ars: 1500, usd: 0, rate: 1 }, { ars: -1, usd: 1, rate: 1501 }, { ars: '1500', usd: 0, rate: 0 }, { ars: Infinity, usd: 0, rate: 0 }, { ars: 1500.001, usd: 0, rate: 0 }, { ars: 1500, usd: 0, rate: 0, eur: 10 }]) assert.throws(() => cashParts(parts, 150000));
});
test('receipts require an unambiguous cash payment and matching cash movement', () => {
  const original = structuredClone(item);
  assert.equal(cashPayment(item, 'payment').amountCents, 150000);
  assert.deepEqual(item, original);
  for (const patch of [{ method: 'otro' }, { method: 'tercero' }, { sharedRecordId: 'shared' }, { cashMovementId: '' }, { amount: 0 }, { cashAccount: 'foreign' }]) assert.throws(() => cashPayment({ ...item, paymentHistory: [{ ...item.paymentHistory[0], ...patch }] }, 'payment'));
  assert.throws(() => cashPayment({ ...item, paymentHistory: [...item.paymentHistory, ...item.paymentHistory] }, 'payment'));
  assert.throws(() => cashPayment(item, 'payment', { type: 'pago', paymentId: 'payment', amount: 1501, cashAccount: 'personal' }), /no coincide/);
  assert.equal(cashPayment({ ...item, paymentHistory: [{ ...item.paymentHistory[0], date: new Date('2026-11-14T01:00:00Z') }] }, 'payment').date, '2026-11-13');
  assert.throws(() => cashPayment({ ...item, paymentHistory: [{ ...item.paymentHistory[0], date: '2026-02-30' }] }, 'payment'), /fecha/);
});
test('receipt PDF is deterministic, handles long references and retains a valid signature field', async () => {
  const content = { preparedAt: '2026-11-13T18:00:00Z', projectId: 'p'.repeat(160), collectionName: 'areaExpenses', itemId: 'i'.repeat(160), paymentId: 'payment', projectName: 'Proyecto de prueba', provider: { name: 'Persona de prueba', cuit: '20123456786' }, signerName: 'Persona de prueba', signerDni: '12345678', parts: cashParts({ ars: 500, usd: 1, rate: 1000 }, 150000), payment: cashPayment(item, 'payment') };
  const receipt = { id: 'test-receipt', contentHash: 'a'.repeat(64), actor: { email: 'supplier@example.test' }, content };
  const a = await cashReceiptPdf(receipt), b = await cashReceiptPdf(receipt);
  assert(a.bytes.equals(b.bytes));
  const pdf = await PDFDocument.load(a.bytes);
  assert.equal(a.field.page, pdf.getPageCount());
  assert.equal(a.field.signerEmail, receipt.actor.email);
  assert(a.field.x >= 0 && a.field.y >= 0 && a.field.x + a.field.w <= 1 && a.field.y + a.field.h <= 1);
  assert(pdf.getPageCount() <= 2);
});
test('a transient database failure is not interpreted as a replaced payment', async () => {
  const failure = Object.assign(new Error('synthetic unavailable'), { code: 14 });
  const service = createCashReceiptService({ db: { doc: () => ({ get: async () => { throw failure; } }) } });
  await assert.rejects(service.current({ scope: { projectId: 'test', collectionName: 'areaExpenses', itemId: 'test' } }), error => error === failure);
});

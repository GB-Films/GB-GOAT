const test = require('node:test');
const assert = require('node:assert/strict');
const { createPaymentReceiptVerifier } = require('./paymentReceiptVerification');
test('a corrected payment receipt must belong to the same expense, payment and storage object', async () => {
  const scope = { projectId: 'project', collectionName: 'areaExpenses', itemId: 'item', paymentId: 'payment' };
  const path = 'projects/project/areaExpenses/item/comprobantes/file.pdf';
  const metadata = { contentType: 'application/pdf', size: '10', metadata: { ...scope, originalFileName: 'original.pdf' } };
  const bucket = { name: 'demo-bucket', file: () => ({ getMetadata: async () => [metadata] }) };
  const read = createPaymentReceiptVerifier(bucket), input = { path, url: `https://firebasestorage.googleapis.com/v0/b/demo-bucket/o/${encodeURIComponent(path)}?alt=media&token=fake-local` };
  assert.equal((await read(scope, input)).originalFileName, 'original.pdf');
  for (const change of [{ path: 'projects/other/comprobantes/file.pdf' }, { path: path.replace('file.pdf', '../file.pdf') }, { url: 'https://example.test/file.pdf' }, { url: input.url.replace('demo-bucket', 'other-bucket') }]) await assert.rejects(read(scope, { ...input, ...change }));
  metadata.metadata.paymentId = 'other'; await assert.rejects(read(scope, input), /no corresponde/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { getProviderExpenseDocuments, uniqueProviderDocuments } from './providerDocuments';
test('provider details include all invoices and separate additional and payment receipts', () => {
  const first = {id:'legacy',path:'invoice-1',url:'https://example.test/1'};
  const second = {id:'invoice-2',path:'invoice-2',url:'https://example.test/2'};
  const documents = getProviderExpenseDocuments({invoice:first,invoices:[first,second],
    otherReceipts:[{path:'withholding',url:'https://example.test/3'}],
    paymentHistory:[{receipt:{path:'payment',url:'https://example.test/4'}},{amount:50}]});
  assert.deepEqual(documents.invoiceDocuments,[first,second]);
  assert.equal(documents.otherReceiptDocuments[0].path,'withholding');
  assert.equal(documents.paymentReceiptDocuments[0].path,'payment');
  assert.equal(documents.paymentReceiptDocuments.length,1);
});
test('project document groups deduplicate the same stored file and ignore missing documents', () => {
  assert.equal(uniqueProviderDocuments([{id:'1',path:'same',url:'https://example.test/1'},{id:'2',path:'same',url:'https://example.test/2'},{id:'missing'}]).length,1);
  assert.deepEqual(getProviderExpenseDocuments({}),{invoiceDocuments:[],otherReceiptDocuments:[],paymentReceiptDocuments:[]});
});

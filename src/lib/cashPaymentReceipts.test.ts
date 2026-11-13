import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { canHaveCashReceipt } from './cashPaymentReceipts';
import { portalDocumentCategory, groupPortalDocumentsByProject, pendingPortalSignatureCount } from './providerPortalUi';
import { portalDeclarationCompletionInput } from './providerDeclarationUi';
import { ProviderPendingSignatures } from '../components/ProviderPendingSignatures';
import { ProviderPortalDocuments } from '../components/ProviderPortalDocuments';

test('receipt action is exclusive to linked cash-box payments', () => {
  const payment = { id: 'p', method: 'caja_efectivo', cashAccount: 'general', amount: 20, cashMovementId: 'm' };
  assert.equal(canHaveCashReceipt(payment), true);
  assert.equal(canHaveCashReceipt({ ...payment, cashAccount: 'personal' }), true);
  for (const patch of [{ method: 'otro' }, { method: 'tercero' }, { amount: 0 }, { cashMovementId: '' }, { sharedRecordId: 'shared' }]) assert.equal(canHaveCashReceipt({ ...payment, ...patch }), false);
});
test('receipt notification opens the receipt category and documents keep contracts and permissions separate', async () => {
  const receipt = { id: 'receipt-request', documentId: 'receipt', projectId: 'sign-folder', goatProjectId: 'real-project', projectName: 'Rodaje ficticio', declarationKind: 'cash_receipt', providerId: 'supplier', portalManaged: true, status: 'pending', title: 'Recibo pendiente' };
  const documents = [receipt, { ...receipt, id: 'old', documentId: 'old', status: 'cancelled', title: 'Recibo anulado' }, { id: 'contract', title: 'Contrato ficticio', status: 'pending', projectId: 'real-project' }, { id: 'third', title: 'Permiso ficticio', declarationKind: 'third_party', signed: true, artifactsReady: true }];
  const html = renderToStaticMarkup(createElement(ProviderPortalDocuments, { documents, declarations: [], providerId: 'supplier', providerType: 'persona', busy: false, loading: false, loaded: true, notice: '', labels: {}, onRefresh() {}, onSign() {}, onDownload: async () => {}, onRecover: async () => {}, onApply: async () => '', onApplyDocument: async () => {}, onReviewData() {}, onReviewCompany() {}, onRevoke() {} }));
  const dom = new JSDOM(html), page = dom.window.document;
  const receipts = page.querySelector('#provider-documents-cash-receipts')!;
  assert.equal(receipts.querySelectorAll('article').length, 2); assert(receipts.hasAttribute('open'));
  assert.match(receipts.textContent!, /Rodaje ficticio/); assert.doesNotMatch(receipts.textContent!, /Contrato ficticio|Permiso ficticio/);
  assert.equal([...receipts.querySelectorAll('button')].filter(button => button.textContent === 'Revisar y firmar').length, 1);
  assert.match(page.querySelector('#provider-documents-third-party')!.textContent!, /Permiso ficticio/);
  assert.doesNotMatch(page.querySelector('#provider-documents-contracts')!.textContent!, /Recibo pendiente|Permiso ficticio/);
  const savedWindow = globalThis.window, savedDocument = globalThis.document;
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const container = dom.window.document.createElement('div'); dom.window.document.body.append(container);
  const root = createRoot(container); let destination = '';
  try {
    await act(async () => root.render(createElement(ProviderPendingSignatures, { documents, onOpen: category => { destination = category; } })));
    await act(async () => container.querySelector('button')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.equal(destination, 'cash-receipts');
  } finally { await act(async () => root.unmount()); Object.assign(globalThis, { window: savedWindow, document: savedDocument }); dom.window.close(); }
});
test('pending receipts show one clear entry point and use their real project grouping', () => {
  const receipt = { id: 'request', documentId: 'receipt', projectId: 'goat_portal_declarations', goatProjectId: 'real-project', projectName: 'Proyecto sintético', declarationKind: 'cash_receipt', providerId: 'supplier', portalManaged: true, status: 'pending' };
  assert.equal(portalDocumentCategory(receipt), 'cash-receipts');
  assert.equal(portalDocumentCategory({ ...receipt, declarationKind: 'third_party' }), 'third-party');
  assert.equal(groupPortalDocumentsByProject([receipt])[0].key, 'project:real-project');
  assert.deepEqual(portalDeclarationCompletionInput(receipt), { action: 'completeCashReceipt', providerId: 'supplier', receiptId: 'receipt' });
  const documents = [receipt, { ...receipt, id: 'duplicate-request' }, { ...receipt, documentId: 'old', status: 'cancelled' }, { ...receipt, documentId: 'obsolete', status: 'replaced' }];
  assert.equal(pendingPortalSignatureCount(documents), 1);
  const html = renderToStaticMarkup(createElement(ProviderPendingSignatures, { documents, onOpen() {} }));
  assert.match(html, /Tenés 1 documento para firmar/); assert.match(html, /Firmar recibo \(1\)/);
  assert.equal(renderToStaticMarkup(createElement(ProviderPendingSignatures, { documents: [{ ...receipt, signed: true }], onOpen() {} })), '');
});

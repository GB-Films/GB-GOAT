import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
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

test('payment receipt actions download the selected file and ask for a reason before cancellation', async () => {
  const calls: Record<string, unknown>[] = [];
  const downloads: string[] = [];
  const source = { fingerprint: 'fixture', amountCents: 10000, date: '2026-11-25', concept: 'Servicio ficticio', projectName: 'Proyecto ficticio', providerName: 'Persona de prueba', signerEmail: 'persona@example.test', cashBoxLabel: 'Caja personal' };
  const receipt = { id: 'receipt', status: 'signed', signed: true, title: 'Recibo de prueba', signing: {}, content: { preparedAt: '2026-11-25T15:00:00Z', parts: { arsCents: 10000, usdCents: 0 } } };
  const adminRequest = async (input: Record<string, unknown>) => {
    calls.push(input);
    if (input.action === 'cashReceiptSource') return { source, receipts: [receipt], canRequest: true };
    if (input.action === 'cashReceiptFile') return { fileName: `${input.artifact}.pdf` };
    if (input.action === 'cancelCashReceipt') { receipt.status = 'cancelled'; return { status: 'cancelled' }; }
    throw new Error('Unexpected action');
  };
  const mock = `export const portalAdminRequest = input => globalThis.goatTestReceipt.adminRequest(input);
    export const downloadPortalFile = file => globalThis.goatTestReceipt.downloads.push(file.fileName);`;
  const hook = registerHooks({ resolve: (name, context, next) => name === '../lib/providerPortal' && context.parentURL?.includes('CashPaymentReceiptButton.tsx')
    ? { url: `data:text/javascript,${encodeURIComponent(mock)}`, format: 'module', shortCircuit: true }
    : next(name, context) });
  const dom = new JSDOM('<div id="app"></div>');
  dom.window.HTMLDialogElement.prototype.showModal ||= function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close ||= function () { this.open = false; };
  // React may have selected its legacy input handler before JSDOM was installed.
  Object.defineProperties(dom.window.HTMLElement.prototype, { attachEvent: { value() {} }, detachEvent: { value() {} } });
  const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true, goatTestReceipt: { adminRequest, downloads } };
  const previous = Object.entries(globals).map(([key, value]) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    return [key, descriptor] as const;
  });
  const container = dom.window.document.getElementById('app')!;
  const root = createRoot(container);
  const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label)!;
  const click = async (label: string) => act(async () => button(label).click());
  try {
    const { CashPaymentReceiptButton } = await import('../components/CashPaymentReceiptButton');
    await act(async () => root.render(createElement(CashPaymentReceiptButton, { projectId: 'project', itemId: 'expense', collectionName: 'areaExpenses',
      payment: { id: 'payment', amount: 100, method: 'caja_efectivo', cashAccount: 'personal', cashMovementId: 'movement' }, canRequest: true })));
    await click('Gestionar recibo');
    assert(button('Descargar original'));
    assert(button('Descargar certificado'));
    await click('Descargar PDF firmado');
    assert.deepEqual(downloads, ['signed.pdf']);
    await click('Anular recibo');
    assert.equal(button('Confirmar anulación').disabled, true);
    assert(!calls.some(input => input.action === 'cancelCashReceipt'));
    const textarea = container.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Duplicado ficticio');
      textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      textarea.dispatchEvent(new dom.window.KeyboardEvent('keyup', { bubbles: true }));
    });
    await click('Confirmar anulación');
    assert.deepEqual(calls.find(input => input.action === 'cancelCashReceipt'), { action: 'cancelCashReceipt', receiptId: 'receipt', reason: 'Duplicado ficticio' });
    assert.match(container.textContent || '', /Recibo anulado/);
  } finally {
    await act(async () => root.unmount());
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
    hook.deregister();
    dom.window.close();
  }
});

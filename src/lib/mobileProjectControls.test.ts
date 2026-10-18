import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MobileExpenseDocuments, ExpenseDocumentsPanel, type MobileExpenseDocumentsProps } from '../pages/project-detail/MobileExpenseDocuments';
import { ShootingDateInput } from '../pages/project-detail/ShootingDateInput';

const props: MobileExpenseDocumentsProps = {
  item: { id: 'demo', invoice: { url: '/invoice.pdf', fileName: 'Factura.pdf' },
    invoices: [{ url: '/invoice.pdf', fileName: 'Factura.pdf' }],
    otherReceipts: [{ id: 'other', url: '/other.pdf', fileName: 'Retencion.pdf' }],
    paymentHistory: [{ id: 'payment', receipt: { url: '/payment.pdf', fileName: 'Transferencia.pdf' } }] },
  canManage: true, canRemove: true, uploadingInvoice: false, uploadingReceipt: false, generatingLink: false,
  onUploadInvoice() {}, onUploadReceipt() {}, onRemoveInvoice() {}, onRemoveReceipt() {}, onCreateInvoiceLink() {},
};

test('mobile expenses expose one documents button, not separate upload and removal buttons', () => {
  const html = renderToStaticMarkup(createElement(MobileExpenseDocuments, props));
  assert.equal((html.match(/<button/g) || []).length, 1);
  assert.match(html, /Comprobantes/);
  assert.doesNotMatch(html, /type="file"|Eliminar|Copiar link/);
});

test('documents panel includes legacy invoices once, additional receipts and payment receipts', () => {
  const html = renderToStaticMarkup(createElement(ExpenseDocumentsPanel, props));
  assert.equal((html.match(/href="\/invoice.pdf"/g) || []).length, 1);
  assert.match(html, /href="\/other.pdf"/);
  assert.match(html, /href="\/payment.pdf"/);
  assert.match(html, /Copiar link de carga/);
  assert.match(html, /Eliminar Factura.pdf/);
  assert.match(html, /Eliminar Retencion.pdf/);
  assert.doesNotMatch(html, /Eliminar Transferencia.pdf/);
  assert.equal((html.match(/type="file"/g) || []).length, 2);
});

test('read-only documents remain viewable without any upload, link or deletion controls', () => {
  const html = renderToStaticMarkup(createElement(ExpenseDocumentsPanel, { ...props, canManage: false, canRemove: false }));
  assert.match(html, /Factura.pdf/);
  assert.match(html, /Retencion.pdf/);
  assert.match(html, /Transferencia.pdf/);
  assert.doesNotMatch(html, /<button|type="file"/);
});

test('in-flight uploads and link generation are disabled', () => {
  const html = renderToStaticMarkup(createElement(ExpenseDocumentsPanel, { ...props, uploadingInvoice: true, uploadingReceipt: true, generatingLink: true }));
  assert.equal((html.match(/disabled=""/g) || []).length, 5);
});

test('shooting date is a visible, focusable native field with an end-date minimum', () => {
  const html = renderToStaticMarkup(createElement(ShootingDateInput, { label: 'Fin de rodaje', value: '2026-10-22', min: '2026-10-21', onChange() {} }));
  assert.match(html, /type="date"/);
  assert.match(html, /aria-label="Fin de rodaje"/);
  assert.match(html, /min="2026-10-21"/);
  assert.doesNotMatch(html, /pointer-events-none|opacity-0|tabindex="-1"|aria-hidden/);
});

test('iPhone home screen icon and standalone manifest use correctly sized square GB GOAT assets', () => {
  const html = readFileSync('index.html', 'utf8');
  assert.match(html, /rel="apple-touch-icon" sizes="180x180" href="%BASE_URL%gb-goat-icon-180.png"/);
  assert.match(html, /apple-mobile-web-app-title" content="GB GOAT"/);
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  for (const icon of manifest.icons) {
    const png = readFileSync(`public/${icon.src}`);
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
    assert.ok(png.byteLength < 20000, 'icons must stay lightweight');
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { documentCategory, filterProjectDocuments, signingDocumentMatchesProvider, type CatalogDocument } from './projectDocumentCatalog';
import { ProjectDocumentsView } from '../pages/project-detail/ProjectDocumentsView';
import { ProjectSigningPanel } from '../pages/project-detail/ProjectSigningPanel';

test('invoices, payment receipts and withholdings share Comprobantes; legacy locations remain visible in three categories', () => {
  const documents = [
    { family: 'finanzas', type: 'factura' }, { family: 'finanzas', type: 'comprobante' }, { family: 'finanzas', type: 'Retención' },
    { family: 'locaciones', type: 'Permiso de filmacion' }, { family: 'locaciones', type: 'Seguro de locacion' }, { family: 'seguros', type: 'Poliza' },
  ].map((item, index) => ({ ...item, id: String(index), providerName: 'Proveedor' }));
  const original = structuredClone(documents);
  assert.deepEqual(documents.map(documentCategory), ['comprobantes', 'comprobantes', 'comprobantes', 'contratos', 'seguros', 'seguros']);
  assert.equal(['comprobantes', 'contratos', 'seguros'].flatMap(category => filterProjectDocuments(documents, category as any, '')).length, documents.length);
  assert.deepEqual(documents, original);
});

test('search matches only the supplier, ignoring accents and name order, inside the selected category', () => {
  const documents = [{ family: 'finanzas', type: 'factura', providerName: 'María García', description: 'Ana' }, { family: 'seguros', providerName: 'Ana López' }];
  assert.deepEqual(filterProjectDocuments(documents, 'comprobantes', 'garcia maria'), [documents[0]]);
  assert.deepEqual(filterProjectDocuments(documents, 'comprobantes', 'ana'), []);
});

test('signing documents can be found by provider id or a matching signer account, including company business names', () => {
  const providers = [{ id: 'person', name: 'María', lastName: 'García', email: 'maria@example.com' }, { id: 'company', businessName: 'Catering del Sur', adminEmail: 'admin@example.com' }];
  assert.equal(signingDocumentMatchesProvider({ providerId: 'person' }, 'garcia', providers), true);
  assert.equal(signingDocumentMatchesProvider({ signatures: [{ email: 'ADMIN@example.com' }] }, 'catering', providers), true);
  assert.equal(signingDocumentMatchesProvider({ signatures: [{ email: 'other@example.com' }] }, 'catering', providers), false);
});

test('the document view has exactly three quick categories and a supplier search without repeated filter dropdowns', () => {
  const documents: CatalogDocument[] = [{ id: 'ret', family: 'finanzas', type: 'Retención', providerName: 'María', fileName: 'retencion.pdf', description: '', amount: 0, url: 'https://example.test/ret' }];
  const html = renderToStaticMarkup(createElement(ProjectDocumentsView, { documents, category: 'comprobantes', onCategoryChange() {}, search: '', onSearchChange() {}, signingSection: 'Signature section' }));
  assert.equal(html.match(/aria-pressed=/g)?.length, 3);
  assert.match(html, /Comprobantes/); assert.match(html, /Contratos/); assert.match(html, /Seguros/); assert.match(html, /Buscar por proveedor/);
  assert.match(html, /retencion.pdf/);
  assert.doesNotMatch(html, /Familia|Finanzas|Locaciones|<select|Signature section/);
});

test('signature controls show progress and confirmation while preserving separate approval status and artifacts', () => {
  const props = { state: { connected: true, documents: [] }, documents: [{ id: 'contract', title: 'Contrato', status: 'completed', declarationStatus: 'pending_review', artifactsReady: true, signatures: [] }], busy: null, downloading: '', error: '', notice: 'Firmas actualizadas.', onRefresh() {}, onDownload() {} };
  const html = renderToStaticMarkup(createElement(ProjectSigningPanel, props));
  assert.doesNotMatch(html, /Abrir GB Sign/); assert.match(html, /Actualizar firmas/); assert.match(html, /Firmas actualizadas/);
  assert.match(html, /PDF firmado/); assert.match(html, /Certificado/); assert.match(html, /Pendiente de aprobación/);
  assert.doesNotMatch(html, /Actualizar conexión|Actualizar estados/);
  const loading = renderToStaticMarkup(createElement(ProjectSigningPanel, { ...props, busy: 'refresh' }));
  assert.match(loading, /Actualizando…/); assert.match(loading, /disabled/);
});

test('contracts use one list: preparation replaces the uploaded row and keeps the canonical signing artifacts', () => {
  const manualDocuments: CatalogDocument[] = [{ id: 'manual-1', sourceDocumentId: 'local-1', family: 'contratos', providerName: 'María', fileName: 'contrato.pdf', description: 'Contrato María', url: 'https://example.test/manual', amount: 0 }];
  const base = { state: { documents: [] }, busy: null, downloading: '', error: '', notice: '', onRefresh() {}, onDownload() {}, onPrepare() {}, manualDocuments };
  const draft = renderToStaticMarkup(createElement(ProjectSigningPanel, { ...base, documents: [] }));
  assert.match(draft, /Preparar firma/);
  const prepared = renderToStaticMarkup(createElement(ProjectSigningPanel, { ...base, documents: [{ id: 'sign-1', sourceDocumentId: 'local-1', title: 'Contrato María', status: 'completed', artifactsReady: true, signatures: [] }] }));
  assert.equal(prepared.match(/<article/g)?.length, 1);
  assert.doesNotMatch(prepared, /Preparar firma|https:\/\/example.test\/manual/);
  assert.match(prepared, /PDF firmado/);
  const readOnly = renderToStaticMarkup(createElement(ProjectSigningPanel, { ...base, documents: [], onPrepare: undefined }));
  assert.doesNotMatch(readOnly, /Preparar firma/);
});

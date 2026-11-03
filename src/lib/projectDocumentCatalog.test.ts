import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DOCUMENT_CATEGORIES, documentCategory, filterProjectDocuments, signingDocumentMatchesProvider, type CatalogDocument } from './projectDocumentCatalog';
import { ProjectDocumentsView } from '../pages/project-detail/ProjectDocumentsView';
import { ProjectDocumentUpload } from '../pages/project-detail/ProjectDocumentUpload';
import { ProjectSigningPanel } from '../pages/project-detail/ProjectSigningPanel';

test('project documents exclude financial records without modifying them; legacy contracts and insurance remain visible', () => {
  const documents = [
    { family: 'finanzas', type: 'factura' }, { family: 'finanzas', type: 'comprobante' }, { family: 'finanzas', type: 'Retención' },
    { family: 'locaciones', type: 'Permiso de filmacion' }, { family: 'locaciones', type: 'Seguro de locacion' }, { family: 'seguros', type: 'Poliza' },
    { type: 'Comprobante de pago' }, { subtype: 'Retenciones' }, { family: 'comprobantes', type: 'Otro' },
    { family: 'finanzas', type: 'Seguro técnico' },
  ].map((item, index) => ({ ...item, id: String(index), providerName: 'Proveedor' }));
  const original = structuredClone(documents);
  assert.deepEqual(documents.map(documentCategory), [null, null, null, 'contratos', 'seguros', 'seguros', null, null, null, null]);
  assert.deepEqual(DOCUMENT_CATEGORIES.flatMap(category => filterProjectDocuments(documents, category.id, '')), documents.slice(3, 6));
  assert.deepEqual(documents, original);
  assert.equal(documentCategory({ family: 'contratos', type: 'Acuerdo de pago' }), 'contratos', 'an explicit contract remains a contract, independently of its title');
});

test('search matches only the supplier, ignoring accents and name order, inside the selected category', () => {
  const documents = [{ family: 'contratos', type: 'Contrato proveedor', providerName: 'María García', description: 'Ana' }, { family: 'seguros', providerName: 'Ana López' }];
  assert.deepEqual(filterProjectDocuments(documents, 'contratos', 'garcia maria'), [documents[0]]);
  assert.deepEqual(filterProjectDocuments(documents, 'contratos', 'ana'), []);
  assert.deepEqual(filterProjectDocuments(documents, 'seguros', 'ana'), [documents[1]]);
});

test('signing documents can be found by provider id or a matching signer account, including company business names', () => {
  const providers = [{ id: 'person', name: 'María', lastName: 'García', email: 'maria@example.com' }, { id: 'company', businessName: 'Catering del Sur', adminEmail: 'admin@example.com' }];
  assert.equal(signingDocumentMatchesProvider({ providerId: 'person' }, 'garcia', providers), true);
  assert.equal(signingDocumentMatchesProvider({ signatures: [{ email: 'ADMIN@example.com' }] }, 'catering', providers), true);
  assert.equal(signingDocumentMatchesProvider({ signatures: [{ email: 'other@example.com' }] }, 'catering', providers), false);
});

test('the view exposes only contracts and insurance, retains signing, and hides financial rows', () => {
  const documents: CatalogDocument[] = [
    { id: 'ret', family: 'finanzas', type: 'Retención', providerName: 'María', fileName: 'retencion.pdf', description: '', amount: 100, url: 'https://example.test/ret' },
    { id: 'policy', family: 'seguros', type: 'Póliza', providerName: 'María', fileName: 'poliza.pdf', description: '', amount: 0, url: 'https://example.test/policy' },
  ];
  const props = { documents, onCategoryChange() {}, search: '', onSearchChange() {}, onUpload() {}, signingSection: 'Signature section' };
  const html = renderToStaticMarkup(createElement(ProjectDocumentsView, { ...props, category: 'seguros' }));
  assert.equal(html.match(/aria-pressed=/g)?.length, 2);
  assert.match(html, /Contratos/); assert.match(html, /Seguros/); assert.match(html, /Buscar por proveedor/);
  assert.match(html, /poliza.pdf/); assert.match(html, /Cargar seguro/);
  assert.doesNotMatch(html, /Comprobantes|retencion.pdf|Retención|Monto|Familia|Finanzas|Locaciones|<select|Signature section/);
  const contracts = renderToStaticMarkup(createElement(ProjectDocumentsView, { ...props, category: 'contratos' }));
  assert.match(contracts, /Signature section/); assert.match(contracts, /Cargar contrato/);
  assert.doesNotMatch(contracts, /retencion.pdf|poliza.pdf/);
});

test('upload offers only contract and insurance categories, with no financial document types', () => {
  for (const category of DOCUMENT_CATEGORIES) {
    const html = renderToStaticMarkup(createElement(ProjectDocumentUpload, { initialCategory: category.id, providers: [], areas: [], busy: false, onClose() {}, onSubmit() {} }));
    assert.match(html, /value="contratos"/); assert.match(html, /value="seguros"/);
    assert.match(html, new RegExp(`name="family" value="${category.id}"`));
    assert.doesNotMatch(html, /comprobantes|finanzas|Factura|Comprobante de pago|Retención|Otro comprobante/);
    assert.match(html, category.id === 'contratos' ? /Contrato proveedor/ : /Seguro técnico/);
  }
});

test('signature controls show progress, application status and artifacts without requesting approval', () => {
  const props = { state: { connected: true, documents: [] }, documents: [{ id: 'contract', title: 'Contrato', status: 'completed', declarationStatus: 'pending_review', artifactsReady: true, signatures: [{ email: 'signer@example.test', status: 'signed' }] }], busy: null, downloading: '', error: '', notice: 'Firmas actualizadas.', onRefresh() {}, onDownload() {} };
  const html = renderToStaticMarkup(createElement(ProjectSigningPanel, props));
  assert.doesNotMatch(html, /Abrir GB Sign/); assert.match(html, /Actualizar firmas/); assert.match(html, /Firmas actualizadas/);
  assert.match(html, /PDF firmado/); assert.match(html, /Certificado/); assert.match(html, /Firma guardada · falta aplicar/);
  assert.match(html, /title="Firmó"/);
  assert.match(html, /signer@example.test: Firmó/);
  assert.doesNotMatch(html, /Actualizar conexión|Actualizar estados/);
  const loading = renderToStaticMarkup(createElement(ProjectSigningPanel, { ...props, busy: 'refresh' }));
  assert.match(loading, /Actualizando…/); assert.match(loading, /disabled/);
});

test('contracts use one list: preparation replaces the uploaded row and keeps the canonical signing artifacts', () => {
  const manualDocuments: CatalogDocument[] = [{ id: 'manual-1', sourceDocumentId: 'local-1', family: 'contratos', providerName: 'María', fileName: 'contrato.pdf', description: 'Contrato María', url: 'https://example.test/manual', amount: 0 }];
  const base = { state: { documents: [] }, busy: null, downloading: '', error: '', notice: '', onRefresh() {}, onDownload() {}, onPrepare() {}, manualDocuments };
  const draft = renderToStaticMarkup(createElement(ProjectSigningPanel, { ...base, documents: [] }));
  assert.match(draft, /Preparar firma/);
  assert.match(draft, /title="No preparado para firmar"/);
  const prepared = renderToStaticMarkup(createElement(ProjectSigningPanel, { ...base, documents: [{ id: 'sign-1', sourceDocumentId: 'local-1', title: 'Contrato María', status: 'completed', artifactsReady: true, signatures: [] }] }));
  assert.equal(prepared.match(/<article/g)?.length, 1);
  assert.doesNotMatch(prepared, /Preparar firma|https:\/\/example.test\/manual/);
  assert.match(prepared, /PDF firmado/);
  const readOnly = renderToStaticMarkup(createElement(ProjectSigningPanel, { ...base, documents: [], onPrepare: undefined }));
  assert.doesNotMatch(readOnly, /Preparar firma/);
});

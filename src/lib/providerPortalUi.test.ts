import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { needsPortalSignature, pendingPortalSignatureCount, portalErrorMessage, representsAnotherProvider } from './providerPortalUi';
import { outdatedProfileDeclaration, profileDeclarationSuperseded } from './providerProfileForm';
import { ProviderSigningGuide } from '../components/ProviderSigningGuide';
import { ProviderProfileForm } from '../components/ProviderProfileForm';
import { ProviderPortalDocuments } from '../components/ProviderPortalDocuments';

const old = { id: 'old', kind: 'profile', owned: true, status: 'pending_review', signedAt: '2026-10-28T10:00:00Z', content: { changes: { dni: { before: '', after: '12345678', critical: true } } } };
test('el contador incluye sólo firmas propias pendientes y deduplica solicitudes del mismo documento', () => {
  const doc = { id: 'request', projectId: 'p', documentId: 'd', status: 'pending', signed: false };
  assert.equal(pendingPortalSignatureCount([doc, { ...doc, id: 'duplicate' }, { ...doc, providerId: 'other-supplier' }, { ...doc, documentId: 'other', status: 'partially_signed' }]), 2);
  for (const status of ['cancelled', 'revoked', 'rejected', 'replaced', 'applied', 'active', 'completed', 'signed']) assert.equal(needsPortalSignature({ ...doc, status }), false);
  assert.equal(needsPortalSignature({ ...doc, signed: true, status: 'partially_signed' }), false, 'faltan firmas ajenas, no la propia');
  assert.equal(needsPortalSignature({ ...doc, declarationKind: 'representation', declarationVersion: 'company-representation-v3' }), false);
  assert.equal(needsPortalSignature({ ...doc, declarationKind: 'representation', declarationVersion: 'company-representation-v4' }), true);
});
test('la aclaración de representación se reserva a empresas o una representación expresa', () => {
  assert.equal(representsAnotherProvider({ type: 'persona', capacity: 'own' }), false);
  assert.equal(representsAnotherProvider({ type: 'persona' }), false);
  assert.equal(representsAnotherProvider({ type: 'persona', capacity: 'authorized_representative' }), true);
  assert.equal(representsAnotherProvider({ type: 'empresa' }), true);
});
test('la guía se entrega plegada y conserva los pasos para completar la firma', () => {
  const html = renderToStaticMarkup(createElement(ProviderSigningGuide, { email: 'persona@example.test', needsRepresentation: false, pendingCount: 2, onDocuments() {} }));
  assert.match(html, /<details[^>]*>/); assert.doesNotMatch(html, /<details[^>]*\sopen/);
  assert.match(html, /<summary[^>]*>Cómo firmar/); assert.match(html, /Firmar y confirmar/);
  assert.doesNotMatch(html, /declaración de representación/);
});
test('una firma anterior no reemplaza datos actuales ni ofrece aplicar un cambio incompatible', () => {
  assert.equal(outdatedProfileDeclaration(old, { dni: '' }), false);
  assert.equal(outdatedProfileDeclaration(old, { dni: '87654321' }), true);
  assert.equal(outdatedProfileDeclaration({ ...old, commonApplied: ['dni'] }, { dni: '12345678' }), false);
  const html = renderToStaticMarkup(createElement(ProviderProfileForm, { provider: { type: 'persona', dni: '87654321' }, declarations: [old], labels: { dni: 'DNI' }, draft: {}, onChange() {}, onPrepare: async () => {}, onApplySigned: async () => {}, busy: false }));
  assert.match(html, /value="87654321"/); assert.doesNotMatch(html, /value="12345678"|Aplicar datos firmados/);
  assert.match(html, /Revisá los datos actuales y firmá nuevamente/); assert.match(html, /Revisar confirmación y firmar/);
});
test('una confirmación posterior aplicada evita volver a pedir la firma por un antecedente viejo', () => {
  const latest = { ...old, id: 'new', status: 'applied', signedAt: '2026-11-02T10:00:00Z' };
  assert.equal(profileDeclarationSuperseded(old, [old, latest]), true);
  const html = renderToStaticMarkup(createElement(ProviderProfileForm, { provider: { type: 'persona', dni: '87654321' }, declarations: [old, latest], labels: { dni: 'DNI' }, draft: {}, onChange() {}, onPrepare: async () => {}, busy: false }));
  assert.doesNotMatch(html, /firmá nuevamente|Revisar confirmación y firmar/);
});
test('el conflicto tiene una indicación breve y los errores de conexión no filtran mensajes internos', () => {
  assert.equal(portalErrorMessage({ message: 'Los datos cambiaron mientras firmabas. Prepará una nueva declaración.' }), 'Tu ficha cambió. Revisá tus datos y firmá nuevamente.');
  assert.equal(portalErrorMessage({ code: 'functions/internal', message: 'INTERNAL PRIVATE STACK' }), 'No pudimos completar la acción. Intentá nuevamente.');
});
test('Documentos prioriza pendientes, conserva descargas y separa antecedentes sin duplicar declaraciones', () => {
  const html = renderToStaticMarkup(createElement(ProviderPortalDocuments, {
    documents: [{ id: 'signed', title: 'Contrato firmado', signed: true, artifactsReady: true }, { id: 'pending', title: 'Contrato pendiente', signed: false, status: 'pending' }, { id: 'decl', title: 'DECLARACION DUPLICADA', documentId: old.id, providerId: 'person', portalManaged: true, signed: true }],
    declarations: [old], providerId: 'person', providerType: 'persona', provider: { dni: '87654321' }, busy: false, loading: false, loaded: true, notice: '', labels: { dni: 'DNI' },
    onRefresh() {}, onSign() {}, onReviewData() {}, onReviewCompany() {}, onRevoke() {}, onDownload: async () => {}, onRecover: async () => {}, onApplyDocument: async () => {}, onApply: async () => '',
  }));
  assert.ok(html.indexOf('Contrato pendiente') < html.indexOf('Contrato firmado'));
  assert.match(html, /PDF firmado/); assert.match(html, /Certificado de evidencia/); assert.match(html, /Historial de declaraciones/);
  assert.match(html, /Datos anteriores/); assert.doesNotMatch(html, /DECLARACION DUPLICADA|Comprobar aplicación de la firma/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { declarationCompletionMessage, declarationDocument, declarationPresentation, type PortalDeclaration } from './providerDeclarationUi';
import { ProviderDeclarationCard } from '../components/ProviderDeclarationCard';

const profile: PortalDeclaration = { id: 'profile-change', kind: 'profile', owned: true, status: 'pending_signature', content: {} };
const doc = { id: 'request', projectId: 'declarations', documentId: profile.id, providerId: 'person', portalManaged: true, signed: false, artifactsReady: false };
const html = (declaration: PortalDeclaration, providerType = 'persona', document?: typeof doc, busy = false) => renderToStaticMarkup(createElement(ProviderDeclarationCard, {
  declaration, providerType, document, busy, onSign: () => {}, onComplete: async () => '', onDownload: async () => {}, onReviewData: () => {},
}));

test('una representación personal anterior no ofrece comprobar/aplicar ni firmar', () => {
  const declaration = { ...profile, kind: 'representation' };
  const ui = declarationPresentation(declaration, 'persona', doc);
  assert.equal(ui.action, null);
  const rendered = html(declaration, 'persona', doc);
  assert.match(rendered, /Antecedente del alta anterior/);
  assert.match(rendered, /Sin acción pendiente/);
  assert.match(rendered, /No necesitás firmarla/);
  assert.doesNotMatch(rendered, /Revisar y firmar|Comprobar aplicación de la firma/);
  assert.match(rendered, /Ver declaración original/);
});

test('representación empresarial mantiene firma y revisión separadas de los datos personales', () => {
  const declaration = { ...profile, kind: 'representation' };
  assert.equal(declarationPresentation(declaration, 'empresa', doc).action, 'sign');
  const pending = html({ ...declaration, status: 'pending_review' }, 'empresa');
  assert.match(pending, /Firmada · pendiente de revisión/);
  assert.doesNotMatch(pending, /Comprobar aplicación de la firma/);
});

test('una firma pendiente abre el documento en lugar de intentar aplicarlo sin firmar', () => {
  assert.equal(declarationPresentation(profile, 'persona', doc).action, 'sign');
  const rendered = html(profile, 'persona', doc);
  assert.match(rendered, /Revisar y firmar/);
  assert.doesNotMatch(rendered, /Comprobar aplicación de la firma/);
  assert.match(rendered, /datos son verídicos/);
  assert.match(rendered, /sin revisión administrativa posterior/);
});

test('firma guardada sin artefactos ofrece recuperar PDF y evidencia', () => {
  const signed = { ...doc, signed: true };
  assert.equal(declarationPresentation(profile, 'persona', signed).action, 'recover');
  assert.match(html(profile, 'persona', signed), /Completar PDF y comprobar aplicación/);
});

test('solicitud firmada antigua conserva acción de aplicación y avisa sobre datos posteriores', () => {
  const pending = { ...profile, status: 'pending_review' };
  assert.equal(declarationPresentation(pending, 'persona').action, 'apply');
  const rendered = html(pending);
  assert.match(rendered, /circuito anterior que ya tiene firma/);
  assert.match(rendered, /Si la ficha cambió/);
  assert.match(rendered, /Comprobar aplicación de la firma/);
  assert.match(rendered, /Revisar mis datos actuales/);
});

test('una firma ya aplicada ofrece las constancias sin pedir aplicarla de nuevo', () => {
  const rendered = html({ ...profile, status: 'applied' }, 'persona', { ...doc, signed: true, artifactsReady: true });
  assert.match(rendered, /ya se aplicaron con tu firma/);
  assert.match(rendered, /PDF firmado/);
  assert.match(rendered, /Certificado de evidencia/);
  assert.doesNotMatch(rendered, /Comprobar aplicación de la firma|Revisar y firmar|Revisar mis datos actuales/);
});

test('documento ausente no muestra un botón de comprobación sin una firma conocida', () => {
  const rendered = html(profile);
  assert.match(rendered, /No encontramos un documento de firma disponible/);
  assert.match(rendered, /Revisar mis datos actuales/);
  assert.doesNotMatch(rendered, /Revisar y firmar|Comprobar aplicación de la firma/);
});

test('no mezcla solicitudes de otra ficha ni documentos ajenos al portal', () => {
  assert.equal(declarationDocument(profile, [doc], 'person'), doc);
  assert.equal(declarationDocument(profile, [doc], 'other'), undefined);
  assert.equal(declarationDocument(profile, [{ ...doc, documentId: 'other' }], 'person'), undefined);
  assert.equal(declarationDocument(profile, [{ ...doc, portalManaged: false }], 'person'), undefined);
});

test('sin autoría no aparecen acciones de firma/aplicación, y ocupado deshabilita acciones', () => {
  assert.doesNotMatch(html({ ...profile, owned: false }, 'persona', doc), /Revisar y firmar|Comprobar aplicación de la firma/);
  assert.match(html(profile, 'persona', doc, true), /button type="button" disabled=""/);
});

test('el mensaje de respuesta distingue aplicado, pendiente y firma incompleta', () => {
  assert.match(declarationCompletionMessage('profile', 'applied'), /datos ya están aplicados/);
  assert.match(declarationCompletionMessage('profile', 'pending_review'), /aplicación todavía no se completó/);
  assert.match(declarationCompletionMessage('representation', 'pending_review'), /pendiente de revisión/);
  assert.match(declarationCompletionMessage('profile', 'pending_signature'), /falta completar la firma/);
});

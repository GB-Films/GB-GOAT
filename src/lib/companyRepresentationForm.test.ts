import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CompanyRepresentationForm } from '../components/CompanyRepresentationForm';
import { ProviderSigningGuide } from '../components/ProviderSigningGuide';
test('empresa compacta: dos lugares de adjuntos y una confirmación, con campos alineados', () => {
  const html = renderToStaticMarkup(createElement(CompanyRepresentationForm, { providerId: 'example', email: 'rep@example.test', busy: false, onPrepare: async () => {}, request: async () => ({}) }));
  assert.equal((html.match(/type="file"/g) || []).length, 2);
  assert.equal((html.match(/type="checkbox"/g) || []).length, 1);
  assert(html.includes('un PDF o hasta dos archivos'));
  assert(html.includes('Poder o respaldo de representación (opcional)'));
  assert(html.includes('Tu DNI (obligatorio)'));
  assert(html.includes('Podés continuar y firmar sin este archivo'));
  assert(html.includes('Declaro bajo mi responsabilidad'));
  assert(html.includes('sin esperar una revisión administrativa'));
  assert(!html.includes('Sujeto a revisión de administración'));
  assert(!html.includes('Tu DNI · frente') && !html.includes('Tu DNI · dorso'));
});

test('la guía identifica cuenta, bandeja, pasos y constancias sin prometer envíos', () => {
  const html = renderToStaticMarkup(createElement(ProviderSigningGuide, { email: 'persona@empresa.test', needsRepresentation: true, pendingCount: 2, onDocuments: () => {} }));
  for (const text of ['persona@empresa.test', 'Mi proveedor → Documentos', 'Pendiente de tu firma', 'Revisar y firmar', 'Firmar y confirmar', 'PDF firmado', 'Certificado de evidencia', 'poder es opcional', '2 por firmar']) assert(html.includes(text), text);
  const active = renderToStaticMarkup(createElement(ProviderSigningGuide, { email: 'persona@empresa.test', needsRepresentation: false, pendingCount: 0, onDocuments: () => {} }));
  assert(!active.includes('Completá la declaración de representación'));
});

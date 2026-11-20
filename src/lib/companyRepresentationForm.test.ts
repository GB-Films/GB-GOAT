import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { CompanyRepresentationForm } from '../components/CompanyRepresentationForm';
import { ProviderSigningGuide } from '../components/ProviderSigningGuide';
test('empresa compacta: dos lugares de adjuntos y una confirmación, con campos alineados', () => {
  const html = renderToStaticMarkup(createElement(CompanyRepresentationForm, { providerId: 'example', email: 'rep@example.test', busy: false, onPrepare: async () => {}, request: async () => ({}) }));
  assert.equal((html.match(/type="file"/g) || []).length, 2);
  assert.equal((html.match(/type="checkbox"/g) || []).length, 1);
  assert(html.includes('un PDF o en hasta dos fotos'));
  assert(html.includes('Poder o respaldo de representación (opcional)'));
  assert(html.includes('Tu DNI (obligatorio)'));
  assert(html.includes('Podés continuar y firmar sin este archivo'));
  assert(html.includes('Declaro bajo mi responsabilidad'));
  assert(html.includes('sin esperar una revisión administrativa'));
  assert(!html.includes('Sujeto a revisión de administración'));
  assert(!html.includes('Tu DNI · frente') && !html.includes('Tu DNI · dorso'));
});

test('un DNI rechazado conserva el motivo al volver desde la acción de firma', async () => {
  const dom = new JSDOM('<div id="app"></div>');
  const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const { createRoot } = await import('react-dom/client');
  const page = dom.window.document;
  const root = createRoot(page.getElementById('app')!);
  let preparations = 0;
  try {
    await act(async () => root.render(createElement(CompanyRepresentationForm, {
      providerId: 'company', email: 'rep@example.test', busy: false,
      request: async () => ({ company: { name: 'Empresa ficticia', cuit: '30111111112' }, evidence: [] }),
      onPrepare: async () => { preparations++; },
    })));
    const input = page.querySelector<HTMLInputElement>('input[name="identity_document"]')!;
    assert.equal(input.disabled, false);
    Object.defineProperty(input, 'files', { value: [{ name: 'dos-caras.pdf', type: 'application/pdf', size: 8 * 1024 * 1024 }] });
    await act(async () => input.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
    const alert = page.querySelector('[role="alert"]')!;
    assert.match(alert.textContent!, /dos-caras\.pdf.*8,0 MB.*límite es 6 MB/);
    const sign = page.querySelector<HTMLButtonElement>('button:not([type])')!;
    assert.equal(sign.disabled, true);
    const dniSection = input.closest<HTMLElement>('[tabindex="-1"]')!;
    let scrolled = false;
    dniSection.scrollIntoView = () => { scrolled = true; };
    const openDni = [...page.querySelectorAll('button')].find(button => button.textContent === 'Ir al DNI')!;
    await act(async () => openDni.click());
    assert.equal(page.activeElement, dniSection);
    assert.equal(scrolled, true);
    assert.equal(page.querySelector('[role="alert"]'), alert);
    assert.equal(preparations, 0);
    assert.equal(input.disabled, false);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
  }
});

test('la guía identifica cuenta, bandeja, pasos y constancias sin prometer envíos', () => {
  const html = renderToStaticMarkup(createElement(ProviderSigningGuide, { email: 'persona@empresa.test', needsRepresentation: true, pendingCount: 2, onDocuments: () => {} }));
  for (const text of ['persona@empresa.test', 'Mi proveedor → Documentos', 'Pendiente de tu firma', 'Revisar y firmar', 'Firmar y confirmar', 'PDF firmado', 'Certificado de evidencia', 'poder es opcional', '2 por firmar']) assert(html.includes(text), text);
  const active = renderToStaticMarkup(createElement(ProviderSigningGuide, { email: 'persona@empresa.test', needsRepresentation: false, pendingCount: 0, onDocuments: () => {} }));
  assert(!active.includes('Completá la declaración de representación'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import { ProviderDetailView } from './ProviderDetailView';

test('copying CUIT, CBU and alias repeatedly keeps one authorization panel and the same project list', async () => {
  // An in-memory DOM exercises React updates, without a browser, session or real data.
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>');
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLDialogElement: dom.window.HTMLDialogElement, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  const copied: string[] = [], timers: Array<() => void> = [], warnings: string[] = [];
  Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText: async (value: string) => { copied.push(value); } } });
  dom.window.setTimeout = ((callback: () => void) => { timers.push(callback); return timers.length; }) as any;
  const originalError = console.error;
  console.error = (...args) => { warnings.push(args.map(String).join(' ')); };
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('app')!);
  const provider = { id: 'provider-copy-fixture', type: 'persona', name: 'Persona de prueba', cuit: '20123456786',
    bankAccount_cbu: '0000000000000000000011', bankAccount_alias: 'persona.prueba' };
  const detail = { provider, totals: { total: 180, paid: 40, debt: 140 }, lines: [],
    projects: [{ id: 'project-fixture', name: 'Proyecto ficticio', total: 180, paid: 40, debt: 140 }] };
  const panelLabel = 'Declaraciones de facturación y cobro';
  try {
    await act(async () => { root.render(createElement(ProviderDetailView, { detail, loading: false, onClose() {},
      // The caller supplies a provider-keyed panel, as ProviderDetailModal does.
      authorizationPanel: createElement('section', { key: provider.id, 'aria-label': panelLabel },
        createElement('h3', null, 'Quién factura y cobra por este proveedor')) })); });
    const panel = dom.window.document.querySelector(`[aria-label="${panelLabel}"]`);
    const projects = dom.window.document.querySelector('[aria-label="Proyectos del proveedor"]');
    const check = () => {
      assert.equal(dom.window.document.querySelectorAll(`[aria-label="${panelLabel}"]`).length, 1, 'copy feedback must not duplicate the authorization card');
      assert.equal(dom.window.document.querySelector(`[aria-label="${panelLabel}"]`), panel, 'the existing card stays mounted');
      assert.equal(dom.window.document.querySelector('[aria-label="Proyectos del proveedor"]'), projects, 'project state stays mounted');
      assert.match(projects!.textContent!, /Proyecto ficticio/);
    };
    check();
    for (let round = 0; round < 2; round++) for (const label of ['CUIT', 'CBU', 'Alias']) {
      const button = dom.window.document.querySelector<HTMLButtonElement>(`button[title="Copiar ${label}"]`)!;
      await act(async () => { button.click(); });
      assert.match(button.textContent!, /Copiado/);
      check();
      await act(async () => { for (const timer of timers.splice(0)) timer(); });
      assert.doesNotMatch(button.textContent!, /Copiado/);
      check();
    }
    assert.deepEqual(copied, Array(2).fill([provider.cuit, provider.bankAccount_cbu, provider.bankAccount_alias]).flat());
    const fullData = [...dom.window.document.querySelectorAll('button')].find(button => button.textContent?.includes('Datos completos del proveedor'))!;
    await act(async () => { fullData.click(); });
    check();
    assert.deepEqual(warnings, [], 'no duplicate key or React update warnings');
  } finally {
    await act(async () => { root.unmount(); });
    console.error = originalError;
    dom.window.close();
    for (const [key, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete (globalThis as any)[key];
  }
});

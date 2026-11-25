import assert from "node:assert/strict";
import { registerHooks } from 'node:module';
import test from "node:test";
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { normalizeSigningDni, personalSignatureFields, signingFailure, signingFieldChoice, signingNextStep, type PortalSignatureInput } from "./portalSigning";

const field = { id: "mine", signerEmail: "PERSONA@example.com", page: 2, x: .2, y: .7, w: .4, h: .12 };
test("only the current signer's real fields are selectable, without changing stored geometry", () => {
  const fields = [field, { ...field, id: "foreign", signerEmail: "other@example.com" }];
  assert.deepEqual(personalSignatureFields(fields, " persona@example.com "), [field]);
  assert.equal(personalSignatureFields(fields, "persona@example.com")[0], field);
  assert.deepEqual(personalSignatureFields(fields, ""), []);
  assert.deepEqual(personalSignatureFields(null, "persona@example.com"), []);
});
test("invalid page or field geometry cannot appear as a valid signing target", () => {
  for (const invalid of [{ page: 0 }, { page: 1.5 }, { x: -.1 }, { y: NaN }, { w: 0 }, { h: Infinity }, { x: .9 }, { y: .99 }, { id: "" }]) {
    assert.deepEqual(personalSignatureFields([{ ...field, ...invalid }], "persona@example.com"), []);
  }
});
test('a single assigned field can be used directly, while multiple fields need a selection', () => {
  const other = { ...field, id: 'second', page: 1 };
  assert.equal(signingFieldChoice([field], ''), field);
  assert.equal(signingFieldChoice([field, other], 'foreign'), undefined);
  assert.equal(signingFieldChoice([field, other], 'second'), other);
  assert.equal(signingFieldChoice([], 'mine'), undefined);
});
test("DNI formatting is removed without silently accepting letters", () => {
  assert.equal(normalizeSigningDni(" 12.345.678 "), "12345678");
  assert.equal(normalizeSigningDni("12-345-678"), "12345678");
  assert.equal(normalizeSigningDni("12ABC345"), "12ABC345");
});

const complete = { preparing: false, hasUrl: true, loadError: '', ready: true, fieldCount: 1,
  selectedPage: 2, targetPage: 2, validDni: true, dniConfirmed: true, hasSignature: true, accepted: true };
test('guidance identifies every blocking requirement before allowing confirmation', () => {
  const cases = [
    [{ preparing: true }, 'preparing'], [{ hasUrl: false }, 'loading'],
    [{ loadError: 'PDF error' }, 'load_error'], [{ ready: false }, 'loading'],
    [{ fieldCount: 0, selectedPage: undefined }, 'unassigned'],
    [{ selectedPage: undefined }, 'field'], [{ validDni: false }, 'dni'],
    [{ dniConfirmed: false }, 'dni_confirmation'], [{ hasSignature: false }, 'signature'],
    [{ accepted: false }, 'consent'], [{}, 'ready'],
  ] as const;
  for (const [change, step] of cases) assert.equal(signingNextStep({ ...complete, ...change }).step, step);
  assert.match(signingNextStep({ ...complete, selectedPage: undefined }).message, /página 2/);
});
test('uncertain or already saved results require checking documents before another attempt', () => {
  for (const code of ['functions/deadline-exceeded', 'functions/unavailable', 'functions/internal',
    'auth/network-request-failed', 'functions/unauthenticated', 'functions/permission-denied', 'portal/signature-saved']) {
    assert.equal(signingFailure({ code }).checkDocuments, true, code);
  }
  assert.equal(signingFailure({ message: 'Failed to fetch' }).checkDocuments, true);
  assert.match(signingFailure({ code: 'portal/signature-saved' }).message, /quedó guardada/);
  assert.deepEqual(signingFailure({ code: 'functions/failed-precondition', message: 'Firebase: Revisá tu DNI. (functions/failed-precondition)' }),
    { checkDocuments: false, message: 'Revisá tu DNI.' });
});

test('the signing dialog advances with one assigned field and submits only after DNI and consent', async () => {
  // Exercise the actual dialog and viewer in a DOM, with two synthetic PDF pages.
  const pdfMock = `export const GlobalWorkerOptions = {};
    export function getDocument() { return { destroy() {}, promise: Promise.resolve({ numPages: 2,
      async getPage() { return { getViewport({scale}) { return { width: 595*scale, height: 842*scale }; },
        render() { return { promise: Promise.resolve(), cancel() {} }; } }; } }) }; }`;
  const hook = registerHooks({ resolve: (name, context, next) => name === 'pdfjs-dist'
    ? { url: `data:text/javascript,${encodeURIComponent(pdfMock)}`, format: 'module', shortCircuit: true }
    : next(name, context) });
  const dom = new JSDOM('<div id="app"></div>', { pretendToBeVisual: true });
  class TestResizeObserver { constructor(private callback: () => void) {} observe() { this.callback(); } disconnect() {} }
  class TestIntersectionObserver { constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {} observe() { this.callback([{ isIntersecting: true }]); } disconnect() {} }
  const globals = { window: dom.window, document: dom.window.document, ResizeObserver: TestResizeObserver, IntersectionObserver: TestIntersectionObserver, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.entries(globals).map(([key, value]) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    return [key, descriptor] as const;
  });
  Object.defineProperties(dom.window.HTMLElement.prototype, { clientWidth: { value: 340 }, clientHeight: { value: 440 }, scrollTo: { value: () => {} } });
  const container = dom.window.document.getElementById('app')!;
  const root = createRoot(container);
  const signed: PortalSignatureInput[] = [];
  const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label)!;
  const active = () => container.querySelector('[aria-current="step"]')?.textContent;
  const click = async (value: HTMLButtonElement | HTMLInputElement) => act(async () => value.click());
  try {
    const { PortalSigningRoom } = await import('../components/PortalSigningRoom');
    await act(async () => root.render(createElement(PortalSigningRoom, {
      document: { title: 'Recibo ficticio', signatureFields: [field, { ...field, id: 'foreign', signerEmail: 'another@example.test' }], requiredDni: '12345678' },
      signer: { email: 'persona@example.com', name: 'Persona de prueba' }, url: 'blob:fixture', loadError: '', onRetry() {}, onClose() {},
      onSubmit: async input => { signed.push(input); throw Object.assign(Error('Interrupción ficticia'), { code: 'functions/unavailable' }); },
    })));
    for (let index = 0; index < 30 && button('Continuar a mis datos').disabled; index++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 12)); });
    assert.match(active() || '', /Documento/);
    assert.match(container.textContent || '', /Tu firma va en la página 2/);
    assert.equal(button('Continuar a mis datos').disabled, false);
    assert.equal(container.querySelector('[data-signature-field-id="foreign"]'), null);
    await click(button('Continuar a mis datos'));
    assert.match(active() || '', /Tus datos/);
    assert.equal(button('Continuar a firmar').disabled, true);
    const [dni, consent] = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    await click(dni);
    await click(button('Continuar a firmar'));
    assert.match(active() || '', /Firma/);
    assert.equal(button('Firmar y confirmar').disabled, true);
    await click(button('Dibujar firma'));
    await click(consent);
    assert.equal(button('Firmar y confirmar').disabled, true, 'a drawn signature requires an actual stroke');
    await click(button('Usar mi nombre'));
    await click(button('Firmar y confirmar'));
    assert.deepEqual(signed, [{ fieldId: 'mine', dni: '12345678', typedName: 'Persona de prueba', signatureType: 'typed', signatureImage: '' }]);
    assert(button('Volver a Documentos'));
    assert.equal(button('Firmar y confirmar'), undefined, 'an uncertain result must not expose a second submission');
  } finally {
    await act(async () => root.unmount());
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
    hook.deregister();
    dom.window.close();
  }
});

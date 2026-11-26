import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { ThirdPartyAuthorizationForm } from '../components/ThirdPartyAuthorizationForm';
import { thirdPartyFormDefaults, type ThirdPartyChoice } from './thirdPartyDefaults';

const choices: ThirdPartyChoice[] = [
  { source: 'signed', party: { name: 'Persona autorizada', cuit: '20333333334', alias: 'cuenta.firmada' } },
  { source: 'saved', party: { name: 'Persona guardada', cuit: '20444444445', cbu: '0000000000000000000001' } },
];
const works = [
  { key: 'p/areaExpenses/w', projectName: 'Rodaje', description: 'Sonido', total: 100, paid: 0 },
  { key: 'p/areaExpenses/v', projectName: 'Rodaje', description: 'Locación', total: 100, paid: 0 },
  { key: 'p2/areaExpenses/v', projectName: 'Segundo proyecto', description: 'Fotografía', total: 100, paid: 0 },
];

test('la solicitud del tercero muestra emisor, CUIT y cuenta, sin requerir documentos ni datos adicionales', () => {
  const html = renderToStaticMarkup(createElement(ThirdPartyAuthorizationForm, {
    works, party: thirdPartyFormDefaults(null), onChange: () => {}, onPrepare: async () => {}, busy: false,
  }));
  assert.equal((html.match(/type="text"/g) || []).length, 3);
  assert(!/type="file"|type="date"|Vigente hasta|constancia|Relación con|Actividad|Motivo|Correo del tercero/.test(html));
  assert(html.includes('Tu cuenta propia se conserva en Mis datos'));
  assert(html.includes('cuenta debe corresponder al titular de la factura'));
  assert(html.includes('bajo mi responsabilidad'));
  assert(html.includes('La firma aplica el permiso sin revisión administrativa'));
  assert.match(html, /Para sumar otros trabajos del mismo proyecto o de otro, creá un nuevo permiso/);
  assert.match(html, /disabled=""[^>]*>Revisar y firmar/);
});

test('reutiliza datos guardados y firmados y envía únicamente los trabajos elegidos tras confirmar', async () => {
  const dom = new JSDOM('<div id="app"></div>');
  const original = { window: globalThis.window, document: globalThis.document, IS_REACT_ACT_ENVIRONMENT: (globalThis as any).IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const container = dom.window.document.getElementById('app')!, root = createRoot(container);
  const prepared: any[] = [];
  function Example() {
    const [party, setParty] = useState(() => thirdPartyFormDefaults({ thirdPartyChoices: choices }));
    return createElement(ThirdPartyAuthorizationForm, { choices, works, party, onChange: setParty, busy: false,
      authorizations: [{ id: 'signed', name: 'Persona autorizada', workCount: 1, scope: 'Rodaje anterior · Sonido' }],
      onRevoke: () => {}, onPrepare: async input => { prepared.push(input); } });
  }
  try {
    await act(async () => root.render(createElement(Example)));
    const select = container.querySelector('select')!;
    const [name, cuit, account] = [...container.querySelectorAll<HTMLInputElement>('input[type=text]')];
    const [project, first, second, other, consent] = [...container.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
    const submit = container.querySelector<HTMLButtonElement>('button[type=submit]')!;
    const click = async (element: HTMLInputElement | HTMLButtonElement) => { await act(async () => element.click()); };
    const choose = async (value: string) => {
      select.value = value;
      await act(async () => select.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
    };
    assert.match(select.options[1].text, /Usado en un permiso firmado/);
    assert.match(select.options[2].text, /Datos cargados/);
    assert.match(container.textContent!, /Revocar permiso/);
    assert.equal(account.value, 'cuenta.firmada');
    assert(submit.disabled && !first.checked && !second.checked && !other.checked);
    container.querySelector('summary')!.click();
    await click(project);
    assert(first.checked && second.checked && !other.checked);
    await click(second);
    assert(project.indeterminate && first.checked && !second.checked);
    await click(consent);
    assert(!submit.disabled);
    await choose('1');
    assert.deepEqual([name.value, cuit.value, account.value], ['Persona guardada', '20444444445', '0000000000000000000001']);
    assert(!consent.checked && submit.disabled);
    await click(consent);
    await click(submit);
    assert.deepEqual(prepared[0].workKeys, [works[0].key]);
    assert.equal(prepared[0].cbu, '0000000000000000000001');
    await choose('0');
    assert.equal(name.value, 'Persona autorizada');
    assert(!consent.checked);
    await click(consent);
    await click(submit);
    assert.deepEqual(prepared[1].workKeys, [works[0].key]);
    assert.equal(prepared[1].alias, 'cuenta.firmada');
  } finally {
    await act(async () => root.unmount());
    Object.assign(globalThis, original);
    dom.window.close();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThirdPartyAuthorizationForm } from '../components/ThirdPartyAuthorizationForm';

test('la solicitud del tercero muestra emisor, CUIT y cuenta, sin requerir documentos ni datos adicionales', () => {
  const html = renderToStaticMarkup(createElement(ThirdPartyAuthorizationForm, {
    provider: { bankAccount_alias: 'cuenta.propia' }, works: [{ key: 'p/areaExpenses/w', projectName: 'Rodaje', description: 'Sonido' }],
    party: { name: '', cuit: '', account: '', expiresOn: '', workKeys: [] }, onChange: () => {}, onPrepare: async () => {}, busy: false,
  }));
  assert.equal((html.match(/type="text"/g) || []).length, 3);
  assert(!/type="file"|constancia|Relación con|Actividad|Motivo|Correo del tercero/.test(html));
  assert(html.includes('CUIT del titular de la factura'));
  assert(html.includes('cuenta.propia'));
  assert(html.includes('cuenta corresponde al titular de la factura'));
  assert(html.includes('bajo mi responsabilidad'));
});

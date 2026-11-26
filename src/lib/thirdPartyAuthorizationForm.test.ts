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
  assert(!/type="file"|type="date"|Vigente hasta|constancia|Relación con|Actividad|Motivo|Correo del tercero/.test(html));
  assert(html.includes('cuenta.propia'));
  assert(html.includes('cuenta debe corresponder al titular de la factura'));
  assert(html.includes('bajo mi responsabilidad'));
  assert(html.includes('se aplica automáticamente'));
  assert(html.includes('No necesita aprobación administrativa'));
});

test('ofrece recuperar el tercero firmado y revocar el permiso desde la ficha', () => {
  const html = renderToStaticMarkup(createElement(ThirdPartyAuthorizationForm, {
    provider: {}, works: [{ key: 'p/areaExpenses/w', projectName: 'Próximo rodaje', description: 'Sonido' }],
    party: { name: 'Borrador', cuit: '20111111112', account: 'cuenta.borrador', workKeys: [], responsibilityConfirmed: false },
    signedDetails: { name: 'Persona autorizada', cuit: '20333333334', alias: 'cuenta.firmada' },
    savedDetails: { name: 'Otro borrador', cuit: '20444444445', alias: 'cuenta.guardada' },
    authorizations: [{ id: 'signed', name: 'Persona autorizada', workCount: 1, scope: 'Rodaje anterior · Sonido' }],
    onRevoke: () => {}, onChange: () => {}, onPrepare: async () => {}, busy: false,
  }));
  assert.match(html, /Usar datos del último tercero autorizado/);
  assert.match(html, /Usar datos guardados/);
  assert.match(html, /Rodaje anterior · Sonido/);
  assert.match(html, /Revocar permiso/);
  assert.match(html, /disabled=""[^>]*>Revisar y firmar/);
});

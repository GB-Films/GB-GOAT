import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { BudgetRowCell } from '../pages/project-detail/BudgetRowCell';
import { ProviderAuthorizationDetails } from './ProviderAuthorizationDetails';
import { authorizationWorkNames, isCurrentPayoutAuthorization, type WorkAuthorization } from '../lib/providerWorkAuthorizations';
const authorization: WorkAuthorization = { id: 'signed', valid: true, status: 'active', effectiveRoles: ['invoice', 'payment'],
  content: { validity: 'until_revoked', workKeys: ['p/areaExpenses/work'], party: { name: 'Tercero autorizado', cuit: '20333333334', holder: 'Titular autorizado', cbu: 'THIRD-PARTY-CBU', alias: 'THIRD-PARTY-ALIAS' } } };
const render = (a: WorkAuthorization, canSeeBankDetails = true) => renderToStaticMarkup(createElement(ProviderAuthorizationDetails, { authorization: a, providerId: 'supplier', canSeeBankDetails }));
test('sólo la autorización vigente de facturación y cobro ofrece la cuenta del tercero para copiar', () => {
  const html = render(authorization);
  for (const text of ['Tercero autorizado', 'Titular autorizado', 'THIRD-PARTY-CBU', 'THIRD-PARTY-ALIAS', 'Ver declaración firmada', 'Copiar CBU/CVU de Tercero autorizado']) assert(html.includes(text), text);
  for (const row of [{ ...authorization, valid: false, status: 'revoked' }, { ...authorization, effectiveRoles: ['payment'] }]) {
    assert.equal(isCurrentPayoutAuthorization(row), false);
    assert.doesNotMatch(render(row), /THIRD-PARTY-CBU|THIRD-PARTY-ALIAS|Copiar CBU/);
  }
  assert.doesNotMatch(render(authorization, false), /THIRD-PARTY-CBU|THIRD-PARTY-ALIAS|Copiar CBU/);
  assert.doesNotMatch(render({ ...authorization, canDownload: false }), /<button[^>]*>.*Ver declaración firmada/);
});
test('el indicador de tercero aparece en el gasto, también cuando la fila no es editable', () => {
  const props = { item: { id: 'work', providerId: 'supplier', providerName: 'Prestador', thirdPartyPayoutRequired: true }, providers: [{ id: 'supplier', name: 'Prestador', type: 'persona' }], type: 'provider' as const, collectionName: 'areaExpenses' as const, disabled: true, onUpdate: async () => {} };
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(BudgetRowCell, props)));
  assert.match(html, /Facturación y cobro por tercero/);
  assert.match(html, /Ver cuentas y autorización del tercero/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(MemoryRouter, null, createElement(BudgetRowCell, { ...props, item: { ...props.item, thirdPartyPayoutRequired: false } }))), /Facturación y cobro por tercero/);
});
test('los proyectos y trabajos mostrados corresponden a los incluidos en la declaración', () => {
  assert.deepEqual(authorizationWorkNames(authorization, [{ projectId: 'p', collectionName: 'areaExpenses', expenseId: 'work', projectName: 'Proyecto visible', description: 'Trabajo declarado' }, { projectId: 'other', collectionName: 'areaExpenses', expenseId: 'work', projectName: 'Ajeno', description: 'No incluido' }]), ['Proyecto visible · Trabajo declarado']);
});

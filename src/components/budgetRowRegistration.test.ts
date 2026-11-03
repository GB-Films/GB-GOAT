import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { BudgetRowCell } from '../pages/project-detail/BudgetRowCell';
import type { RegistrationEvidence } from '../lib/providerRegistration';

const render = (provider: any, disabled = false, providerId = 'legacy', registrationEvidence?: RegistrationEvidence) => renderToStaticMarkup(createElement(MemoryRouter, {},
  createElement(BudgetRowCell, { item:{id:'expense',providerId,providerName:'Persona de prueba'},providers:[provider],type:'provider',
    onUpdate:async()=>{},onCreateProviderInvite:async()=>true,disabled,registrationEvidence })));
test('provisional expense shows yellow status and specific intake link; registered record clears both', () => {
  const pending=render({id:'legacy',dni_cuit:'12345678'});
  assert.match(pending,/bg-amber-50/);assert.match(pending,/Alta pendiente · ficha provisoria/);assert.match(pending,/Copiar link de alta/);
  const registered=render({id:'legacy',personalGoogleAccount:{uid:'person'}});
  assert.doesNotMatch(registered,/Alta pendiente|Copiar link de alta/);
});
test('old signed registration removes the yellow warning and new-intake link without requiring a supplier login', () => {
  const html=render({id:'legacy',source:'manual'},false,'legacy',{status:'ready',registeredIds:new Set(['legacy'])});
  assert.doesNotMatch(html,/Alta pendiente|Copiar link de alta|Verificando alta/);
});
test('an unavailable lookup shows uncertainty, never a false demand for a new registration', () => {
  for(const status of ['loading','error'] as const){
    const html=render({id:'legacy'},false,'legacy',{status,registeredIds:new Set()});
    assert.doesNotMatch(html,/Alta pendiente|Copiar link de alta/);
    assert.match(html,status==='loading'?/Verificando alta/:/Alta sin verificar/);
  }
});
test('read-only expense and unbound name keep status but cannot create a provider-specific link', () => {
  assert.doesNotMatch(render({id:'legacy'},true),/Copiar link de alta/);
  const nameOnly=render({id:'different',name:'Persona de prueba'},false,'');
  assert.match(nameOnly,/Alta pendiente/);assert.doesNotMatch(nameOnly,/Copiar link de alta/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { BudgetRowCell } from '../pages/project-detail/BudgetRowCell';

const render = (provider: any, disabled = false, providerId = 'legacy') => renderToStaticMarkup(createElement(MemoryRouter, {},
  createElement(BudgetRowCell, { item:{id:'expense',providerId,providerName:'Persona de prueba'},providers:[provider],type:'provider',
    onUpdate:async()=>{},onCreateProviderInvite:async()=>true,disabled })));
test('provisional expense shows yellow status and specific intake link; registered record clears both', () => {
  const pending=render({id:'legacy',dni_cuit:'12345678'});
  assert.match(pending,/bg-amber-50/);assert.match(pending,/Alta pendiente · ficha provisoria/);assert.match(pending,/Copiar link de alta/);
  const registered=render({id:'legacy',personalGoogleAccount:{uid:'person'}});
  assert.doesNotMatch(registered,/Alta pendiente|Copiar link de alta/);
});
test('read-only expense and unbound name keep status but cannot create a provider-specific link', () => {
  assert.doesNotMatch(render({id:'legacy'},true),/Copiar link de alta/);
  const nameOnly=render({id:'different',name:'Persona de prueba'},false,'');
  assert.match(nameOnly,/Alta pendiente/);assert.doesNotMatch(nameOnly,/Copiar link de alta/);
});

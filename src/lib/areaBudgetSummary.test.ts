import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AreaBudgetSummary } from '../pages/project-detail/AreaBudgetSummary';

test('compact area summary preserves amounts and selection without projected labels', () => {
  const html = renderToStaticMarkup(createElement(AreaBudgetSummary, {
    assigned: 1000, spent: 800, balance: 200, areas: ['Arte'],
  }));
  assert.match(html, /Resumen presupuesto/);
  assert.match(html, /1 área seleccionada · Arte/);
  assert.match(html, /Gasto global/);
  assert.match(html, /text-red-600[^>]*>\$800/);
  assert.match(html, /text-emerald-600[^>]*>\$200/);
  assert.doesNotMatch(html, /Proyectado|proyectado|registros cargados/);
});

test('negative balance is red and zero balance stays green', () => {
  const negative = renderToStaticMarkup(createElement(AreaBudgetSummary, {
    assigned: 1000, spent: 1200, balance: -200, areas: ['Arte', 'Vestuario'],
  }));
  assert.match(negative, /2 áreas seleccionadas · Arte, Vestuario/);
  assert.match(negative, /text-red-600[^>]*>\$-200/);
  const zero = renderToStaticMarkup(createElement(AreaBudgetSummary, {
    assigned: 0, spent: 0, balance: 0, areas: ['Arte'],
  }));
  assert.match(zero, /text-emerald-600[^>]*>\$0/);
});

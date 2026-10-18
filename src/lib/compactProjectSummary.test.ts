import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProjectSummaryMetrics } from '../pages/project-detail/ProjectSummaryMetrics';

test('compact summary preserves all four admin amounts and their signs', () => {
  const html = renderToStaticMarkup(createElement(ProjectSummaryMetrics, { isProjectAdmin: true, budget: 5500000, cost: 5220324.01, incidences: 0, balance: 279675.99 }));
  for (const label of ['Presupuesto', 'Costo proyectado', 'Incidencias', 'Saldo']) assert.match(html, new RegExp(label));
  for (const value of [5500000, 5220324.01, 279675.99]) assert.ok(html.includes(value.toLocaleString()));
  assert.match(html, /px-2 py-1.5 sm:px-4 sm:py-3/);
  assert.match(html, /text-emerald-600/);
});

test('collaborators only see their assigned budget and no incidence card; negative balances remain red', () => {
  const html = renderToStaticMarkup(createElement(ProjectSummaryMetrics, { isProjectAdmin: false, budget: 50, cost: 100, incidences: 999999, balance: -50 }));
  assert.match(html, /Presupuesto asignado/);
  assert.doesNotMatch(html, /Incidencias|999/);
  assert.match(html, /text-rose-600[^>]*>\$-50/);
});

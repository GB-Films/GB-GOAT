import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProjectCommercialSummary } from '../pages/project-detail/ProjectCommercialSummary';
import { ProjectKeyContacts } from '../pages/project-detail/ProjectKeyContacts';

const project = { projectCode: 'G EX 0001', clientName: 'Cliente de prueba', companyName: 'Empresa de prueba', brandName: 'Marca de prueba', serviceName: 'Producción', controlTotalContractArs: 1000000, controlTotalContractUsd: 500, controlTotalUrl: 'https://example.com/private-source' };

test('commercial summary renders no metadata, contract or source link for non-administrators', () => {
  assert.equal(renderToStaticMarkup(createElement(ProjectCommercialSummary, { project, isProjectAdmin: false })), '');
});

test('commercial summary preserves separate ARS/USD reference for project administrators', () => {
  const html = renderToStaticMarkup(createElement(ProjectCommercialSummary, { project, isProjectAdmin: true }));
  assert.match(html, /G EX 0001/);
  assert.match(html, /ARS 1.000.000 \+ USD 500/);
  assert.match(html, /https:\/\/example.com\/private-source/);
  const legacy = renderToStaticMarkup(createElement(ProjectCommercialSummary, { project: { controlTotalContractCurrency: 'USD', controlTotalContractAmount: 100 }, isProjectAdmin: true }));
  assert.match(legacy, /USD 100/);
});

test('non-admin contacts are readable without assignment or removal controls', () => {
  const html = renderToStaticMarkup(createElement(ProjectKeyContacts, {
    people: [{ id: 'director', label: 'Director', provider: { id: 'p1', name: 'José', lastName: 'Pérez' } }],
    providers: [], canEdit: false, onAssign: async () => {},
  }));
  assert.match(html, /José Pérez/);
  assert.doesNotMatch(html, /combobox|<button|<input/);
});

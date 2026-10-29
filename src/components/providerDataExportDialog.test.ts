import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProviderDataExportDialog } from './ProviderDataExportDialog';

test('export selection exposes all people beyond the old sixty-person limit', () => {
  const providers = Array.from({ length: 125 }, (_, index) => ({ id: `person-${index}`, type: 'persona', name: 'Persona', lastName: `Apellido${String(index).padStart(3, '0')}` }));
  const html = renderToStaticMarkup(createElement(ProviderDataExportDialog, { providers: [...providers, { id: 'company', type: 'empresa', name: 'Empresa excluida', lastName: '' }], onClose: () => {}, onExport: async () => {} }));
  assert.equal((html.match(/role="option"/g) || []).length, 125);
  assert.match(html, /Apellido124, Persona/);
  assert.doesNotMatch(html, /Empresa excluida|Escribí para encontrar más personas/);
});

test('export dialog renders registration controls, chosen order and dates including undated people', () => {
  const providers = [
    { id: 'old', name: 'Ana', lastName: 'Primera', createdAt: '2026-10-01T12:00:00Z' },
    { id: 'new', name: 'Zoe', lastName: 'Ultima', createdAt: '2026-10-29T12:00:00Z' },
    { id: 'undated', name: 'Celia', lastName: 'SinFecha' },
  ];
  const html = renderToStaticMarkup(createElement(ProviderDataExportDialog, { providers, initialOrder: 'registration-desc', onClose: () => {}, onExport: async () => {} }));
  assert.match(html, /Ordenar por/);
  assert.match(html, /Inscripción: más recientes/);
  assert.match(html, /Inscripción: más antiguas/);
  assert.match(html, /Inscripción: 29\/10\/2026/);
  assert.match(html, /Sin fecha de inscripción/);
  assert.ok(html.indexOf('Ultima, Zoe') < html.indexOf('Primera, Ana'));
  assert.ok(html.indexOf('Primera, Ana') < html.indexOf('SinFecha, Celia'));
});

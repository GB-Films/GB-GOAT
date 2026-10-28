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

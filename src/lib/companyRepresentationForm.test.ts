import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CompanyRepresentationForm } from '../components/CompanyRepresentationForm';
test('empresa compacta: dos lugares de adjuntos y una confirmación, con campos alineados', () => {
  const html = renderToStaticMarkup(createElement(CompanyRepresentationForm, { providerId: 'example', email: 'rep@example.test', busy: false, onPrepare: async () => {}, request: async () => ({}) }));
  assert.equal((html.match(/type="file"/g) || []).length, 2);
  assert.equal((html.match(/type="checkbox"/g) || []).length, 1);
  assert(html.includes('un PDF o hasta dos archivos'));
  assert(html.includes('Documentación de representación'));
  assert(!html.includes('Tu DNI · frente') && !html.includes('Tu DNI · dorso'));
});

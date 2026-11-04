import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProjectScopePermissions } from './ProjectScopePermissions';

const props = { areas: ['Arte'], subcategories: ['Utilería', 'Asistencia'].map(subcategory => ({ key: `Arte||${subcategory}`, area: 'Arte', subcategory, budget: 0 })), onChange: () => {} };
test('los botones muestran herencia, exclusiones amarillas y área parcial sin depender de un listado explícito', () => {
  const full = renderToStaticMarkup(createElement(ProjectScopePermissions, { ...props, access: { allowedCategories: ['Arte'] } }));
  assert.match(full, /Arte \/ Utilería: incluida/);
  assert.match(full, /Arte \/ Asistencia: incluida/);
  assert.doesNotMatch(full, /Parcial|Excluida/);
  const partial = renderToStaticMarkup(createElement(ProjectScopePermissions, { ...props, access: { allowedCategories: ['Arte'], excludedSubcategories: ['Arte||Utilería'] } }));
  assert.match(partial, /aria-pressed="mixed"/);
  assert.match(partial, /Arte · Parcial/);
  assert.match(partial, /bg-amber-100/);
  assert.match(partial, /Arte \/ Utilería · Excluida/);
  assert.match(partial, /Arte \/ Asistencia: incluida/);
});
test('un administrador conserva acceso total y no presenta controles de alcance engañosos', () => {
  const html = renderToStaticMarkup(createElement(ProjectScopePermissions, { ...props, access: { role: 'admin', excludedSubcategories: ['Arte||Utilería'] } }));
  assert.doesNotMatch(html, /Parcial|Excluida/);
  assert.match(html, /disabled=""/);
  assert.match(html, /acceso completo/);
});

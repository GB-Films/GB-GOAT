import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TeamFromProvider, TeamProviderSelection, teamProviderError, type TeamProviderPreview } from '../components/TeamFromProvider';

const preview: TeamProviderPreview = { providerId: 'p', name: 'Julia Ojeda', email: 'julia@example.test', alreadyMember: false, projects: [], fingerprint: 'version' };
const base = { preview, isOwner: false, role: 'colaborador', confirmProjects: false, busy: false, onRole: () => {}, onConfirm: () => {}, onAssign: () => {}, onExisting: () => {} };
test('registered provider search begins without a link or arbitrary email assignment', () => {
  const html = renderToStaticMarkup(createElement(TeamFromProvider, { isOwner: false, onAssigned: async () => {} }));
  assert.match(html, /Incorporar una persona dada de alta/); assert.match(html, /Nombre, apellido o correo/); assert.match(html, /Buscar persona/);
  assert(!html.includes('type="email"')); assert(!html.includes('Generar link'));
});
test('role selection uses registered email, preserves owner-only administration and explains project scope', () => {
  const html = renderToStaticMarkup(createElement(TeamProviderSelection, base));
  assert.match(html, /julia@example.test/); assert.match(html, /value="admin" disabled=""/);
  assert.match(html, /sin repetir el alta/); assert.match(html, /proyectos se asignan por separado/);
  const owner = renderToStaticMarkup(createElement(TeamProviderSelection, { ...base, isOwner: true, role: 'admin' }));
  assert(!owner.includes('value="admin" disabled')); assert.match(owner, /acceso completo a la app y a todos los proyectos/);
});
test('existing team users offer review, not a second incorporation or accidental downgrade', () => {
  const html = renderToStaticMarkup(createElement(TeamProviderSelection, { ...base, preview: { ...preview, alreadyMember: true, role: 'jefe_produccion' } }));
  assert.match(html, /Ya está en el equipo/); assert.match(html, /Ver en equipo/); assert(!html.includes('Incorporar al equipo')); assert(!html.includes('<select'));
});
test('preexisting project assignments must be explicitly confirmed before enabling the user', () => {
  const props = { ...base, preview: { ...preview, projects: [{ id: 'project', name: 'Bancor', role: 'jefe_area', owner: false, areas: ['Campo'] }] } };
  const html = renderToStaticMarkup(createElement(TeamProviderSelection, props));
  assert.match(html, /Bancor/); assert.match(html, /Jefe de Área/); assert.match(html, /Campo/); assert.match(html, /Revisé y quiero conservar/);
  assert.match(html, /disabled=""[^>]*><svg/);
  assert(!/disabled=""[^>]*><svg/.test(renderToStaticMarkup(createElement(TeamProviderSelection, { ...props, confirmProjects: true }))));
});
test('failed queries and ambiguous assignments give stage-specific recovery without leaking internal details', () => {
  const error = { code: 'functions/internal', message: 'PRIVATE_ACCOUNT_STACK' };
  assert.match(teamProviderError(error, 'search'), /volvé a buscar/);
  assert.match(teamProviderError(error, 'preview'), /volvé a seleccionar/);
  assert.match(teamProviderError(error, 'assign'), /misma persona y rol/);
  assert(!teamProviderError(error, 'assign').includes('PRIVATE'));
});

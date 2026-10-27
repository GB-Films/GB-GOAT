import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProjectTeam } from '../pages/project-detail/ProjectTeam';
import { MobileExpenseAmount } from '../pages/project-detail/MobileExpenseAmount';
import { CashBoxPicker } from '../pages/project-detail/CashBoxPicker';

test('project team displays assigned access and exposes no management controls to read-only viewers', () => {
  const html = renderToStaticMarkup(createElement(ProjectTeam, {
    members: [{ email: 'person@example.com', role: 'jefe_area', allowedTabs: ['areas', 'cajas'], allowedCategories: ['Arte'], canEditBudgetAreas: false }],
    canAdd: false, canManage: false, onAdd() {}, onManage() {},
  }));
  assert.match(html, /Jefe de Área/);
  assert.match(html, /Arte/);
  assert.match(html, /Áreas · Cajas/);
  assert.match(html, /Sin edición de gastos/);
  assert.doesNotMatch(html, /<button/);
  assert.match(html, /space-y-3 rounded-xl border border-slate-200 bg-white p-3/);
  assert.doesNotMatch(html, /roles y permisos actuales|Los administradores generales mantienen/);
});

test('paid total is green, partial payment stays distinct and no amount can be edited without permission', () => {
  const paid = renderToStaticMarkup(createElement(MobileExpenseAmount, { item: { id: 'paid', total: 1000, paid: true }, paidAmount: 1000, canEdit: false, onUpdate: async () => {} }));
  assert.match(paid, /font-black text-emerald-600/);
  assert.doesNotMatch(paid, /Pagado \$/);
  assert.doesNotMatch(paid, /Total · Editar/);
  const partial = renderToStaticMarkup(createElement(MobileExpenseAmount, { item: { id: 'partial', total: 1000 }, paidAmount: 300, canEdit: false, onUpdate: async () => {} }));
  assert.match(partial, /font-black text-slate-900/);
  assert.match(partial, /text-emerald-600[^>]*>Pagado \$300/);
});

test('the compact cash header identifies its owner, shows the balance once and hides General for non-admin viewers', () => {
  const html = renderToStaticMarkup(createElement(CashBoxPicker, { rows: [{ email: 'p@example.com', responsible: { displayName: 'Persona' }, balance: 0 }], value: 'p@example.com', onChange() {}, showGeneral: false, generalOut: 200 }));
  assert.match(html, /Persona/);
  assert.match(html, /p@example.com/);
  assert.match(html, /Saldo/);
  assert.equal(html.match(/\$0/g)?.length, 1);
  assert.doesNotMatch(html, /Caja General/);
  assert.doesNotMatch(html, /Filtrar cajas|Todas las cajas/);
});

test('administrators can filter all, General or a person while keeping balances separate', () => {
  const rows = [{ email: 'p@example.com', responsible: { displayName: 'Persona' }, balance: 100 }];
  const all = renderToStaticMarkup(createElement(CashBoxPicker, { rows, value: 'all', onChange() {}, showGeneral: true, generalOut: 200 }));
  assert.match(all, /Filtrar cajas/);
  assert.match(all, /Todas las cajas/);
  assert.match(all, /Caja General/);
  assert.match(all, /p@example.com/);
  assert.match(all, /\$100/);
  assert.doesNotMatch(all, /\$300/);
  assert.match(all, /aria-pressed="true"/);
  const general = renderToStaticMarkup(createElement(CashBoxPicker, { rows, value: 'general', onChange() {}, showGeneral: true, generalOut: 200 }));
  assert.match(general, /Salida neta/);
  assert.match(general, /\$200/);
});

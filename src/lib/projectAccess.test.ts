import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canEditExistingPayment,
  canEditProjectArea,
  canEditProjectSubcategory,
  canOrganizeProjectArea,
  canOrganizeProjectSubcategory,
  canViewProjectSubcategory,
  hasFullProjectAreaAccess,
  toggleProjectAreaAccess,
  toggleProjectSubcategoryAccess,
  normalizeAllowedTabs,
} from './projectAccess';

test('organizar subcategorías depende de edición de la categoría, sin exigir rol admin', () => {
  const editor = { role: 'jefe_area', allowedCategories: ['Arte', 'Campo'], allowedTabs: ['areas'], canEditBudgetAreas: true };
  assert.equal(canOrganizeProjectArea(false, editor, 'Arte'), true);
  assert.equal(canOrganizeProjectSubcategory(false, editor, 'Arte', 'Vestuario'), true);
  assert.equal(canOrganizeProjectSubcategory(false, editor, 'Campo', 'Vestuario'), true);
  assert.equal(canOrganizeProjectArea(false, editor, 'Post'), false);
  for (const access of [{ ...editor, canEditBudgetAreas: false }, { ...editor, allowedTabs: ['resumen'] },
    { ...editor, allowedCategories: [], allowedSubcategories: ['Arte||Vestuario'] }]) {
    assert.equal(canOrganizeProjectSubcategory(false, access, 'Arte', 'Vestuario'), false);
  }
  const partial = { ...editor, excludedSubcategories: ['Arte||Utilería'] };
  assert.equal(canOrganizeProjectSubcategory(false, partial, 'Arte', 'Utilería'), false);
  assert.equal(canOrganizeProjectSubcategory(false, partial, 'Arte', 'Vestuario'), true);
  assert.equal(canOrganizeProjectSubcategory(true, partial, 'Arte', 'Utilería'), true);
});

test('seleccionar un área incluye subcategorías existentes y futuras, con exclusiones explícitas', () => {
  const full = { ...toggleProjectAreaAccess({}, 'Arte'), allowedTabs: ['areas'], canEditBudgetAreas: true };
  for (const name of ['Utilería', 'Asistencia', 'Futura']) {
    assert.equal(canViewProjectSubcategory(false, full, 'Arte', name), true);
  }
  const partial = { ...full, ...toggleProjectSubcategoryAccess(full, 'Arte', 'Utilería') };
  assert.deepEqual(partial.excludedSubcategories, ['Arte||Utilería']);
  assert.equal(canViewProjectSubcategory(false, partial, 'Arte', 'Utilería'), false);
  assert.equal(canEditProjectSubcategory(false, partial, 'Arte', 'Utilería'), false);
  assert.equal(canEditProjectSubcategory(false, partial, 'Arte', 'Asistencia'), true);
  assert.equal(canEditProjectSubcategory(false, partial, 'Arte', ''), true);
  assert.equal(hasFullProjectAreaAccess(false, partial, 'Arte'), false);
  assert.equal(canEditProjectArea(false, partial, 'Arte'), false);
  assert.equal(canViewProjectSubcategory(false, { ...partial, allowedSubcategories: ['Arte||Utilería'] }, 'Arte', 'Utilería'), false);
  assert.equal(canEditProjectSubcategory(true, partial, 'Arte', 'Utilería'), true);
  const restored = toggleProjectSubcategoryAccess(partial, 'Arte', 'Utilería');
  assert.deepEqual(restored.excludedSubcategories, []);
  assert.equal(hasFullProjectAreaAccess(false, restored, 'Arte'), true);
});

test('el área alterna todos/ninguno y las subcategorías también se pueden delegar solas', () => {
  const partial = { allowedCategories: ['Arte'], allowedSubcategories: ['Post||Color'], excludedSubcategories: ['Arte||Utilería'] };
  const off = toggleProjectAreaAccess(partial, 'Arte');
  assert.deepEqual(off, { allowedCategories: [], allowedSubcategories: ['Post||Color'], excludedSubcategories: [] });
  const child = toggleProjectSubcategoryAccess(off, 'Arte', 'Utilería');
  assert.equal(canViewProjectSubcategory(false, child, 'Arte', 'Utilería'), true);
  assert.equal(canViewProjectSubcategory(false, child, 'Arte', 'Asistencia'), false);
  const on = toggleProjectAreaAccess(child, 'Arte');
  assert.deepEqual(on.allowedSubcategories, ['Post||Color']);
  assert.equal(hasFullProjectAreaAccess(false, on, 'Arte'), true);
  assert.equal(canEditProjectSubcategory(true, null, ''), false);
});

test('un jefe de área sólo edita áreas explícitamente asignadas', () => {
  const access = {
    allowedTabs: ['resumen', 'areas'],
    allowedCategories: ['Arte'],
    canEditBudgetAreas: true,
  };

  assert.equal(canEditProjectArea(false, access, 'Arte'), true);
  assert.equal(canEditProjectArea(false, access, 'Sonido'), false);
  assert.equal(canEditProjectArea(true, null, 'Sonido'), true);
});

test('una subcategoría delegada no concede acceso al resto del área', () => {
  const access = {
    allowedTabs: ['areas'],
    allowedCategories: [],
    allowedSubcategories: ['Producción||Catering'],
    canEditBudgetAreas: true,
  };

  assert.equal(canEditProjectSubcategory(false, access, 'Producción', 'Catering'), true);
  assert.equal(canEditProjectSubcategory(false, access, 'Producción', 'Transporte'), false);
});

test('los permisos legacy se normalizan sin reabrir Presu Ppal', () => {
  const tabs = normalizeAllowedTabs(['resumen', 'presupuesto', 'areas'], 'jefe_area');
  assert.equal(tabs.includes('presupuesto'), false);
  assert.equal(tabs.includes('saldos'), true);
  assert.equal(tabs.includes('documentos'), true);
  assert.equal(tabs.includes('proveedores'), true);
});

test('sólo administradores corrigen o eliminan pagos existentes', () => {
  assert.equal(canEditExistingPayment(true), true);
  assert.equal(canEditExistingPayment(false), false);
});


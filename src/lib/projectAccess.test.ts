import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canEditExistingPayment,
  canEditProjectArea,
  canEditProjectSubcategory,
  normalizeAllowedTabs,
} from './projectAccess';

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


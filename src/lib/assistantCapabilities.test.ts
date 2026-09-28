import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAssistantCapabilities,
  canAssistantCreateProviderInvite,
  canAssistantDeleteAreaExpense,
  canAssistantEditSubcategory,
  canAssistantManagePayment,
  describeAssistantScope,
} from './assistantCapabilities';

const project = {
  projectId: 'proj-1',
  projectName: 'Largometraje',
  projectCreatedBy: 'owner-uid',
  categories: ['Arte', 'Vestuario', 'Locaciones'],
  activeAreas: [],
};

test('el dueño del proyecto conserva todo el alcance', () => {
  const capabilities = buildAssistantCapabilities({ ...project, userId: 'owner-uid' });

  assert.equal(capabilities.role, 'owner');
  assert.equal(capabilities.isProjectAdmin, true);
  assert.equal(capabilities.can.editMainBudget, true);
  assert.equal(capabilities.can.deleteAreas, true);
  assert.equal(capabilities.can.viewResults, true);
  assert.equal(capabilities.can.seeFullCash, true);
  assert.equal(capabilities.tabs.includes('resultado'), true);
  assert.deepEqual(capabilities.areas.map((scope) => scope.area), ['Arte', 'Vestuario', 'Locaciones']);
  assert.ok(capabilities.areas.every((scope) => scope.canEditArea));
});

test('un administrador global opera el proyecto aunque no sea colaborador', () => {
  const capabilities = buildAssistantCapabilities({ ...project, userId: 'otro-uid', globalRole: 'admin' });

  assert.equal(capabilities.isAppAdmin, true);
  assert.equal(capabilities.isProjectAdmin, true);
  assert.equal(capabilities.can.createProviders, true);
  assert.equal(capabilities.can.editProviders, true);
  assert.equal(capabilities.can.manageCollaborators, true);
});

test('un usuario sin colaborador y sin ser dueño no tiene alcance', () => {
  const capabilities = buildAssistantCapabilities({ ...project, userId: 'ajeno' });

  assert.equal(capabilities.can.viewProject, false);
  assert.deepEqual(capabilities.tabs, []);
  assert.deepEqual(capabilities.areas, []);
  assert.equal(capabilities.can.editMainBudget, false);
  assert.match(describeAssistantScope(capabilities), /sin rol asignado/);
});

test('un jefe de producción no edita el presupuesto principal ni ve resultado', () => {
  const capabilities = buildAssistantCapabilities({
    ...project,
    userId: 'prod-uid',
    globalRole: 'jefe_produccion',
    collaborator: {
      role: 'jefe_produccion',
      allowedTabs: ['resumen', 'areas', 'cajas', 'saldos', 'documentos', 'proveedores', 'permisos'],
      allowedCategories: ['Arte'],
      canEditBudgetAreas: true,
    },
  });

  assert.equal(capabilities.isProjectAdmin, false);
  assert.equal(capabilities.can.viewResults, false);
  assert.equal(capabilities.can.editMainBudget, false);
  assert.equal(capabilities.can.assignCollaboratorAreas, true);
  assert.equal(capabilities.can.seeFullCash, true);
  assert.equal(capabilities.can.uploadDocuments, true);
  assert.deepEqual(capabilities.areas.map((scope) => scope.area), ['Arte']);
  assert.equal(capabilities.areas[0].canEditArea, true);
  assert.ok(!capabilities.tabs.includes('resultado'));
});

test('un jefe de área acotado por subcategoría sólo edita esas subcategorías', () => {
  const capabilities = buildAssistantCapabilities({
    ...project,
    userId: 'area-uid',
    globalRole: 'colaborador',
    collaborator: {
      role: 'jefe_area',
      allowedTabs: ['resumen', 'areas', 'cajas', 'saldos', 'documentos', 'proveedores'],
      allowedCategories: ['Arte'],
      allowedSubcategories: ['Vestuario||Zapatos'],
      canEditBudgetAreas: true,
    },
  });

  assert.equal(capabilities.can.editMainBudget, false);
  assert.equal(capabilities.can.manageCollaborators, false);
  assert.equal(capabilities.can.seeFullCash, false);
  assert.equal(capabilities.can.createProviders, false);
  assert.deepEqual(capabilities.areas.map((scope) => scope.area), ['Arte', 'Vestuario']);

  const vestuario = capabilities.areas.find((scope) => scope.area === 'Vestuario');
  assert.equal(vestuario?.canEditArea, false);
  assert.deepEqual(vestuario?.canEditSubcategories, ['Zapatos']);
  assert.equal(canAssistantEditSubcategory(capabilities, 'Vestuario', 'Zapatos'), true);
  assert.equal(canAssistantEditSubcategory(capabilities, 'Vestuario', 'Sombreros'), false);
  // Arte está asignada completa, así que cualquiera de sus subcategorías es editable.
  assert.equal(canAssistantEditSubcategory(capabilities, 'Arte', 'Utilería'), true);
  assert.equal(canAssistantEditSubcategory(capabilities, 'Locaciones', 'Estudio'), false);
});

test('los pagos del presupuesto principal se bloquean cuando el área está activa', () => {
  const capabilities = buildAssistantCapabilities({ ...project, userId: 'owner-uid', activeAreas: ['Arte'] });

  assert.equal(canAssistantManagePayment(capabilities, 'budgetItems', { area: 'Arte' }), false);
  assert.equal(canAssistantManagePayment(capabilities, 'budgetItems', { area: 'Locaciones' }), true);
  assert.equal(canAssistantManagePayment(capabilities, 'areaExpenses', { area: 'Arte', subcategory: 'Utilería' }), true);
});

test('los links de alta de proveedor siguen las mismas reglas que los pagos', () => {
  const areaLead = buildAssistantCapabilities({
    ...project,
    userId: 'area-uid',
    collaborator: {
      role: 'jefe_area',
      allowedTabs: ['resumen', 'areas', 'cajas', 'saldos', 'documentos', 'proveedores'],
      allowedCategories: ['Arte'],
      canEditBudgetAreas: true,
    },
  });

  assert.equal(canAssistantCreateProviderInvite(areaLead, 'areaExpenses', { area: 'Arte' }), true);
  assert.equal(canAssistantCreateProviderInvite(areaLead, 'areaExpenses', { area: 'Locaciones' }), false);
  assert.equal(canAssistantCreateProviderInvite(areaLead, 'budgetItems', { area: 'Arte' }), false);
});

test('un gasto con pagos registrados no se puede borrar ni con permiso de área', () => {
  const capabilities = buildAssistantCapabilities({
    ...project,
    userId: 'admin-uid',
    collaborator: {
      role: 'admin',
      allowedTabs: ['areas'],
      allowedCategories: ['Arte'],
      canEditBudgetAreas: true,
    },
  });

  const baseExpense = { area: 'Arte', subcategory: 'Utilería' };
  assert.equal(canAssistantDeleteAreaExpense(capabilities, baseExpense), true);
  assert.equal(canAssistantDeleteAreaExpense(capabilities, { ...baseExpense, paid: true }), false);
  assert.equal(canAssistantDeleteAreaExpense(capabilities, { ...baseExpense, paymentLocked: true }), false);
  assert.equal(canAssistantDeleteAreaExpense(capabilities, { ...baseExpense, paymentHistory: [{ amount: 1 }] }), false);
});

test('el alcance descripto menciona áreas, pestañas y límites', () => {
  const capabilities = buildAssistantCapabilities({
    ...project,
    userId: 'area-uid',
    collaborator: {
      role: 'jefe_area',
      allowedTabs: ['resumen', 'areas'],
      allowedCategories: ['Arte'],
      allowedSubcategories: ['Vestuario||Zapatos'],
      canEditBudgetAreas: true,
    },
  });
  const scope = describeAssistantScope(capabilities);

  assert.match(scope, /Rol en el proyecto: jefe de área/);
  assert.match(scope, /Arte \(completa\)/);
  assert.match(scope, /Vestuario \(subcategorías: Zapatos\)/);
  assert.match(scope, /No puede ver Resultado/);
  assert.doesNotMatch(scope, /editar el presupuesto principal/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { categoryBudgetMap, directCategoryBudget, getCategoryBudget, getAssignedBudgetTotal, renamedCategoryBudgets, categoryBudgetExportRows } from './categoryBudgets';
import { planCategoryBudgetChange, validateCategoryBudgetReplacement } from './categoryBudgetStore';
import { categoryDeletionPlan, resolveBudgetCategories } from './budgetCategories';
import { calculateProjectFinance, calculateProjectResult } from './projectFinance';
import { CategoryBudgetDialog } from '../pages/project-detail/CategoryBudgetDialog';

const rows = [{ area: 'Arte', total: 300 }, { area: 'Producción', total: 200 }];
const project = { categories: ['Arte', 'Producción'], executiveCategoryDefaultApplied: true, activeAreas: ['Arte'], categoryBudgets: { Arte: 1000, Producción: 250 } };

test('global category allocation replaces its item estimate, including explicit zero; legacy totals stay unchanged', () => {
  assert.equal(getCategoryBudget({}, rows, 'Arte'), 300);
  assert.equal(getCategoryBudget(project, rows, 'Arte'), 1000);
  assert.equal(getAssignedBudgetTotal(project, rows), 1250);
  assert.equal(getAssignedBudgetTotal(project, rows, ['Arte']), 1000);
  assert.equal(getCategoryBudget({ categoryBudgets: { Arte: 0 } }, rows, 'Arte'), 0);
  assert.equal(directCategoryBudget({}, 'Arte'), null);
  assert.deepEqual(categoryBudgetMap({ categoryBudgets: { Arte: -1, Mal: Infinity, Bien: 0 } }), { Bien: 0 });
});

test('allocations are never payment entries or debt; estimates use allocations until actual area expenses exist', () => {
  const p = { ...project, budgetTotal: 5000 };
  const actual = [{ area: 'Arte', total: 400, paymentHistory: [{ amount: 100 }] }];
  const finance = calculateProjectFinance(p, [], actual);
  assert.equal(finance.committedBudget, 1250);
  assert.equal(finance.spent, 400);
  assert.equal(finance.paid, 100);
  assert.equal(finance.debt, 300);
  assert.equal(finance.entries.length, 1);
  assert.equal(calculateProjectResult(p, [], []).directCostTotal, 1250);
  assert.equal(calculateProjectResult(p, [], actual).directCostTotal, 650);
  const inactive = calculateProjectFinance({ categoryBudgets: { Arte: 1000 } }, [{ area: 'Arte', total: 300 }], []);
  assert.equal(inactive.committedBudget, 1000);
  assert.equal(inactive.spent, 300);
  assert.equal(inactive.debt, 300);
});

test('an active empty category can get a budget; creation needs no fake expense or provider', () => {
  const before = { categories: ['Arte'], executiveCategoryDefaultApplied: true, activeAreas: ['Arte'] };
  const next = planCategoryBudgetChange(before, [], { area: 'Arte', create: false, amount: 1500, expectedAmount: null });
  assert.deepEqual(next.categoryBudgets, { Arte: 1500 });
  assert.deepEqual(next.categories, ['Arte']);
  const created = planCategoryBudgetChange(before, [], { area: 'Vestuario', create: true, amount: 500, expectedAmount: null });
  assert.deepEqual(created.categories, ['Arte', 'Vestuario']);
  assert.deepEqual(created.categoryBudgets, { Vestuario: 500 });
  assert.equal(planCategoryBudgetChange({ categories: [' Arte '], executiveCategoryDefaultApplied: true }, [], { area: ' Arte ', create: false, amount: 30, expectedAmount: null }).categoryBudgets[' Arte '], 30, 'editing retains legacy category identity');
});

test('subcategories protect their allocated cents when reducing or removing the global allocation', () => {
  const p = { ...project, areaExpenseSubcategoryBudgets: { 'Arte||Utilería': { area: 'Arte', budget: 600.25, budgetAssigned: true } } };
  const change = { area: 'Arte', create: false, amount: 600.25, expectedAmount: 1000 };
  assert.equal(planCategoryBudgetChange(p, rows, change).categoryBudgets.Arte, 600.25);
  assert.throws(() => planCategoryBudgetChange(p, rows, { ...change, amount: 600.24 }), /subcategorías/);
  assert.throws(() => planCategoryBudgetChange(p, rows, { ...change, amount: null }), /subcategorías/);
  const removed = planCategoryBudgetChange(p, [{ area: 'Arte', total: 700 }], { ...change, amount: null });
  assert.equal(directCategoryBudget(removed, 'Arte'), null);
  assert.equal(getCategoryBudget(removed, [{ area: 'Arte', total: 700 }], 'Arte'), 700);
});

test('stale allocation, duplicate name and invalid amount reject; other category budgets survive', () => {
  const change = { area: 'Arte', create: false, amount: 2000, expectedAmount: 1000 };
  assert.throws(() => planCategoryBudgetChange({ ...project, categoryBudgets: { Arte: 1100 } }, rows, change), /cambió/);
  for (const amount of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER]) assert.throws(() => planCategoryBudgetChange(project, rows, { ...change, amount }), /válido/);
  assert.throws(() => planCategoryBudgetChange(project, rows, { ...change, area: ' arte ', create: true }), /existe/);
  assert.equal(planCategoryBudgetChange(project, rows, change).categoryBudgets.Producción, 250);
});

test('rename and deletion carry or remove the allocation; orphaned allocations remain visible for recovery', () => {
  const budgets = renamedCategoryBudgets(project, 'Arte', 'Escenografía');
  assert.deepEqual(budgets, { Escenografía: 1000, Producción: 250 });
  const deleted = categoryDeletionPlan({ ...project, activeAreas: [] }, 'Arte');
  assert.deepEqual(deleted.categoryBudgets, { Producción: 250 });
  assert.ok(!resolveBudgetCategories(deleted).includes('Arte'));
  assert.ok(resolveBudgetCategories({ categories: [], categoryBudgets: { Arte: 500 } }).includes('Arte'));
  assert.throws(() => categoryDeletionPlan(project, 'Arte'), /CATEGORY_ACTIVE/);
});

test('category dialog offers optional allocation at creation and an amount-only edit for an active category', () => {
  const common = { detailedBudget: 0, minimum: 0, onClose() {}, onSave: async () => {} };
  const create = renderToStaticMarkup(createElement(CategoryBudgetDialog, { ...common, create: true, area: '', amount: null }));
  assert.match(create, /Nombre de la categoría/);
  assert.match(create, /Asignar presupuesto sin detalle/);
  assert.match(create, /Crear categoría/);
  const edit = renderToStaticMarkup(createElement(CategoryBudgetDialog, { ...common, create: false, area: 'Arte', amount: 1500 }));
  assert.match(edit, /Presupuesto de Arte/);
  assert.match(edit, /Presupuesto asignado \(ARS\)/);
  assert.match(edit, /value="1500"/);
  assert.doesNotMatch(edit, /Nombre de la categoría|Proveedor|Factura/);
});

test('allocation export identifies its own budget column without inventing expenses or payments', () => {
  assert.deepEqual(categoryBudgetExportRows({ categoryBudgets: { Arte: 1500, Sonido: 0 } }), [
    { Tipo: 'Asignación global', Area: 'Arte', 'Presupuesto asignado': 1500 },
    { Tipo: 'Asignación global', Area: 'Sonido', 'Presupuesto asignado': 0 },
  ]);
  assert.deepEqual(categoryBudgetExportRows({}), []);
});

test('a copied budget may consist only of allocations, and cannot erase allocated subcategory capacity', () => {
  const p = { ...project, areaExpenseSubcategoryBudgets: { 'Arte||Utilería': { area: 'Arte', budget: 600, budgetAssigned: true } } };
  assert.doesNotThrow(() => validateCategoryBudgetReplacement(p, [], { Arte: 600 }));
  assert.throws(() => validateCategoryBudgetReplacement(p, [], { Arte: 599.99 }), /SUBCATEGORY_BUDGET_EXCEEDED/);
  assert.throws(() => validateCategoryBudgetReplacement(p, [], {}), /SUBCATEGORY_BUDGET_EXCEEDED/);
  assert.doesNotThrow(() => validateCategoryBudgetReplacement(p, [{ area: 'Arte', total: 700 }], {}));
});

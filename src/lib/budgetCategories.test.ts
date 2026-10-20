import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryDeletionPlan, DEFAULT_BUDGET_CATEGORIES, resolveBudgetCategories } from './budgetCategories';

test('legacy empty Raid-style categories delete only the chosen category and persist on reload', () => {
  const before = { categories: [], activeAreas: ['Producción'] };
  const next = { ...before, ...categoryDeletionPlan(before, 'Arte') };
  assert.deepEqual(next.categories, DEFAULT_BUDGET_CATEGORIES.filter(category => category !== 'Arte'));
  assert.deepEqual(resolveBudgetCategories(next), next.categories);
  assert.ok(resolveBudgetCategories(next).includes('Producción'));
  assert.throws(() => categoryDeletionPlan(before, 'Producción'), /CATEGORY_ACTIVE/);
});

test('missing legacy categories share the same defaults as displayed categories', () => {
  assert.deepEqual(resolveBudgetCategories({}), DEFAULT_BUDGET_CATEGORIES);
  assert.equal(categoryDeletionPlan({}, 'Dirección').categories.length, DEFAULT_BUDGET_CATEGORIES.length - 1);
});

test('deleting Ejecutiva does not bring it back on reload', () => {
  const before = { categories: ['Arte'] };
  assert.deepEqual(resolveBudgetCategories(before), ['Ejecutiva', 'Arte']);
  const after = categoryDeletionPlan(before, 'Ejecutiva');
  assert.deepEqual(resolveBudgetCategories(after), ['Arte']);
});

test('an intentionally empty budget stays empty and active areas never disappear', () => {
  const next = categoryDeletionPlan({ categories: ['Arte'], executiveCategoryDefaultApplied: true }, 'Arte');
  assert.deepEqual(resolveBudgetCategories(next), []);
  assert.deepEqual(resolveBudgetCategories({ ...next, activeAreas: ['Producción'] }), ['Producción']);
});

test('custom categories retain their exact names and order without duplicating executive areas', () => {
  assert.deepEqual(resolveBudgetCategories({ categories: ['Ejecutiva GB', 'Arte', 'Arte'], activeAreas: ['Arte'] }), ['Ejecutiva GB', 'Arte']);
  assert.deepEqual(resolveBudgetCategories({ categories: ['Arte', 'Custom'], executiveCategoryDefaultApplied: true }), ['Arte', 'Custom']);
});

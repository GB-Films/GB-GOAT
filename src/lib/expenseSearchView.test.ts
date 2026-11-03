import assert from 'node:assert/strict';
import test from 'node:test';
import { expenseGroupCollapsed, searchedExpenseAreas } from './expenseSearchView';

test('search reveals collapsed matches across selected/hidden areas and clearing restores the previous view', () => {
  const collapse = Object.freeze({ Campo: true, Arte: false, Post: true });
  const subcategories = Object.freeze({ 'Campo__General': true, 'Post__Edición': true });
  const selected = Object.freeze(['Arte']);
  const campo = { area: 'Campo', expenses: [{ id: 'costilla', providerName: 'Persona Costilla' }], subcategoryGroups: [{ subcategory: 'General' }] };
  const arte = { area: 'Arte', expenses: [], subcategoryGroups: [] };
  const post = { area: 'Post', expenses: [{ id: 'costilla-post', providerName: 'Persona Costilla' }], subcategoryGroups: [{ subcategory: 'Edición' }] };
  const rows = [campo, arte, post];
  assert.deepEqual(searchedExpenseAreas(rows, selected, 'costi'), [campo, post]);
  for (const value of Object.values(collapse)) assert.equal(expenseGroupCollapsed(value, 'costi'), false);
  for (const value of Object.values(subcategories)) assert.equal(expenseGroupCollapsed(value, 'costi'), false);
  assert.deepEqual(searchedExpenseAreas(rows, selected, ''), [arte]);
  assert.equal(expenseGroupCollapsed(collapse.Campo, ''), true);
  assert.equal(expenseGroupCollapsed(subcategories['Campo__General'], ''), true);
  assert.deepEqual(selected, ['Arte']);
  assert.deepEqual(campo.expenses, [{ id: 'costilla', providerName: 'Persona Costilla' }]);
});

test('blank search preserves empty selection; category/subcategory names can match without expenses', () => {
  const area = { area: 'Producción', expenses: [], subcategoryGroups: [] };
  assert.deepEqual(searchedExpenseAreas([area], [], ' PRODUCCION '), [area]);
  const subcategory = { area: 'Arte', expenses: [], subcategoryGroups: [{ subcategory: 'Utilería' }] };
  assert.deepEqual(searchedExpenseAreas([subcategory], [], 'utileria'), [subcategory]);
  assert.deepEqual(searchedExpenseAreas([area], [], '   '), []);
  assert.equal(expenseGroupCollapsed(false, ''), false);
  assert.equal(expenseGroupCollapsed(undefined, ''), false);
  assert.equal(expenseGroupCollapsed(true, '  '), true);
  assert.deepEqual(searchedExpenseAreas([], ['Campo'], 'costi'), [], 'search cannot add rows outside the permission-scoped input');
});

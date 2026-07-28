import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCashMovementTarget } from './cashMovementTargets';

const budgetItems = [{ id: 'budget-1', description: 'Catering' }];
const areaExpenses = [{ id: 'area-1', description: 'Compras varias' }];

test('resolves a linked area expense', () => {
  const result = resolveCashMovementTarget(
    { type: 'pago', collectionName: 'areaExpenses', itemId: 'area-1' },
    budgetItems,
    areaExpenses,
  );

  assert.equal(result.status, 'found');
  if (result.status === 'found') {
    assert.equal(result.collectionName, 'areaExpenses');
    assert.equal(result.item.description, 'Compras varias');
  }
});

test('marks a reference as missing when its expense was deleted', () => {
  const result = resolveCashMovementTarget(
    { type: 'pago', collectionName: 'areaExpenses', itemId: 'deleted-area-expense' },
    budgetItems,
    areaExpenses,
  );

  assert.deepEqual(result, {
    status: 'missing',
    collectionName: 'areaExpenses',
    itemId: 'deleted-area-expense',
  });
});

test('keeps legacy unlinked payments separate from deleted expenses', () => {
  assert.deepEqual(
    resolveCashMovementTarget({ type: 'pago' }, budgetItems, areaExpenses),
    { status: 'unlinked' },
  );
});

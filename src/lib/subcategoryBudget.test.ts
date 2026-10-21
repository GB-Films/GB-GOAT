import assert from 'node:assert/strict';
import test from 'node:test';
import { getSubcategoryBudgetCapacity } from './subcategoryBudget';

test('una subcategoría nueva sólo puede usar el remanente de su categoría', () => {
  const capacity = getSubcategoryBudgetCapacity(1_000, {
    'Arte||Utilería': { area: 'Arte', budget: 600, budgetAssigned: true },
    'Arte||Catering': { area: 'Arte', budget: 800, budgetAssigned: false },
    'Producción||Viajes': { area: 'Producción', budget: 200, budgetAssigned: true },
  }, 'Arte');
  assert.equal(capacity.assignedElsewhere, 600);
  assert.equal(capacity.available, 400);
  assert.equal(capacity.exceeds(400), false);
  assert.equal(capacity.exceeds(400.01), true);
});

test('al editar se libera su asignación anterior y cuentan las entradas antiguas', () => {
  const capacity = getSubcategoryBudgetCapacity(1_000, {
    'Arte||Utilería': 300,
    'Arte||Catering': { area: 'Arte', budget: 500 },
  }, 'Arte', 'Arte||Utilería');
  assert.equal(capacity.available, 500);
  assert.equal(capacity.exceeds(500), false);
  assert.equal(capacity.exceeds(500.01), true);
});

test('sin presupuesto principal no se puede asignar un importe positivo', () => {
  const capacity = getSubcategoryBudgetCapacity(0, {}, 'Arte');
  assert.equal(capacity.available, 0);
  assert.equal(capacity.exceeds(0), false);
  assert.equal(capacity.exceeds(1), true);
});

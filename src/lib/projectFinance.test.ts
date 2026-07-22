import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateProjectFinance,
  calculateProjectResult,
  getItemDebt,
  getPaymentTotal,
  getProjectExpenseEntries,
} from './projectFinance';

test('evita duplicar presupuesto y gasto cuando un área está activa', () => {
  const project = { budgetTotal: 1000, activeAreas: ['Arte'] };
  const budgetItems = [
    { id: 'b-arte', area: 'Arte', total: 500, paymentHistory: [] },
    { id: 'b-sonido', area: 'Sonido', total: 300, paymentHistory: [] },
  ];
  const areaExpenses = [
    { id: 'e-arte', area: 'Arte', total: 450, paymentHistory: [{ amount: 200 }] },
  ];

  const entries = getProjectExpenseEntries(project, budgetItems, areaExpenses);
  assert.deepEqual(entries.map((entry) => entry.item.id), ['e-arte', 'b-sonido']);

  const totals = calculateProjectFinance(project, budgetItems, areaExpenses);
  assert.equal(totals.committedBudget, 800);
  assert.equal(totals.spent, 750);
  assert.equal(totals.paid, 200);
  assert.equal(totals.debt, 550);
  assert.equal(totals.margin, 250);
  assert.equal(totals.marginPercent, 25);
});

test('la deuda nunca es negativa aunque exista un sobrepago histórico', () => {
  const item = { total: 100, paymentHistory: [{ amount: 80 }, { amount: 40 }] };
  assert.equal(getPaymentTotal(item), 120);
  assert.equal(getItemDebt(item), 0);
});

test('Resultado trata las incidencias como gastos excepto Margen', () => {
  const result = calculateProjectResult({
    budgetTotal: 1000,
    categories: ['Producción'],
    resultIncidences: {
      imprevistos: 10,
      impuestos: 5,
      margen: 20,
    },
  }, [
    { area: 'Producción', total: 500 },
  ], []);

  assert.equal(result.directCostTotal, 500);
  assert.equal(result.expenseIncidenceTotal, 150);
  assert.equal(result.totalCost, 650);
  assert.equal(result.estimatedMargin, 350);
  assert.equal(result.marginIncidence, 200);
  assert.equal(result.margin, 550);
  assert.equal(Math.round(result.marginPercent), 55);
});

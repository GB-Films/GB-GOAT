import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateProjectFinance,
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

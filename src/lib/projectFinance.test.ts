import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { BANI_PROVIDER_ID, isInternalBudgetEstimate } from './internalBudgetEstimate';
import { documentProjectChoices } from './providerDocumentSelection';
const internalBackend = createRequire(import.meta.url)('../../functions/internalBudgetEstimate.js');
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

test('BANI internal estimate is a forecast, never external debt, paid, overdue or a document target', () => {
  const item = { id: 'estimate', providerId: BANI_PROVIDER_ID, economicNature: 'internal_estimate', area: 'Post Producción', total: 1500000 };
  assert.equal(isInternalBudgetEstimate(item), true); assert.equal(internalBackend.isInternalBudgetEstimate(item), true);
  const project = { budgetTotal: 5500000, crmProjectImportVersion: 2, activeAreas: [] };
  const finance = calculateProjectFinance(project, [item], []);
  assert.equal(finance.committedBudget, 1500000); assert.equal(finance.spent, 0); assert.equal(finance.paid, 0);
  assert.equal(finance.debt, 0); assert.equal(finance.unpaidLines, 0); assert.deepEqual(finance.entries, []);
  assert.equal(getItemDebt(item), 0);
  assert.deepEqual(documentProjectChoices([{ projectId: 'g', projectName: 'G', expenseId: item.id, collectionName: 'budgetItems', total: item.total, item }], 'invoice'), []);
  const noGPrice = calculateProjectFinance({ ...project, budgetTotal: 0, controlTotalContractAmount: null }, [item], []);
  assert.equal(noGPrice.budgetTotal, 0, 'B assignment does not become the unknown G sale value');
  assert.equal(calculateProjectResult(project, [item], []).directCostTotal, 1500000, 'forecast remains in the estimated result');
});

test('the confirmed global B price stays in the estimate without adding or replacing it with its breakdown', () => {
  const estimate = { providerId: BANI_PROVIDER_ID, economicNature: 'internal_estimate', area: 'Post Producción', total: 1500000 };
  const details = [{ providerId: 'another', area: 'Post Producción', total: 400000 }];
  const project = { budgetTotal: 5500000 };
  assert.equal(calculateProjectResult(project, [estimate, ...details], []).directCostTotal, 1500000);
  assert.equal(calculateProjectResult(project, [estimate], details).directCostTotal, 1500000);
  assert.equal(calculateProjectFinance(project, [estimate, ...details], []).committedBudget, 1500000);
  assert.equal(calculateProjectFinance(project, [estimate, ...details], []).spent, 400000);
  assert.equal(calculateProjectResult(project, [{ ...estimate, total: 0 }, ...details], []).directCostTotal, 0, 'confirmed zero B remains zero, never replaced by another cost');
  const oldBani = { ...estimate, economicNature: undefined };
  assert.equal(isInternalBudgetEstimate(oldBani), false); assert.equal(getItemDebt(oldBani), 1500000);
  assert.equal(isInternalBudgetEstimate({ ...estimate, providerId: 'other' }), false, 'never reclassify another supplier');
});

test('un contrato USD importado conserva presupuesto GOAT cero hasta su carga manual', () => {
  const project = { budgetTotal: 0, controlTotalContractCurrency: 'USD' };
  const finance = calculateProjectFinance(project, [{ area: 'Producción', total: 500 }], []);
  assert.equal(finance.committedBudget, 500);
  assert.equal(finance.budgetTotal, 0);
  assert.equal(calculateProjectResult(project, [{ area: 'Producción', total: 500 }], []).saleValue, 0);
});

test('un gasto pagado por tercero sigue siendo costo y deuda hasta reintegrarlo', () => {
  const project = { budgetTotal: 100 };
  const item = { area: 'Transporte', total: 100, paymentHistory: [
    { id: 'external', amount: 80, method: 'tercero', thirdPartyPayerId: 'person-1', thirdPartyPayerName: 'Persona Ejemplo', reimbursements: [
      { id: 'r1', amount: 30, cashMovementId: 'cash-1', cashAccount: 'general', createdBy: 'admin', createdByEmail: 'admin@example.test', date: '' },
    ] },
  ] };
  const finance = calculateProjectFinance(project, [], [item]);
  assert.equal(finance.spent, 100);
  assert.equal(finance.paid, 30);
  assert.equal(finance.reimbursementDebt, 50);
  assert.equal(finance.debt, 70); // $20 owed to the service provider + $50 owed to the payer.
  assert.equal(finance.margin, 0);
});

test('Resultado trata las incidencias como gastos excepto Margen', () => {
  const result = calculateProjectResult({
    budgetTotal: 1000,
    categories: ['Producción'],
    resultIncidences: {
      imprevistos: 10,
      impuestos: 5,
      financiacion: 0,
      administracion: 0,
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

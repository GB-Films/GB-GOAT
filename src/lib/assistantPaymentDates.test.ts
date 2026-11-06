import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAssistantCapabilities } from './assistantCapabilities';
import type { AssistantProjectContext } from './assistantTools';
import { MAX_ASSISTANT_PAYMENT_DATES, preparePaymentDatePlan } from './assistantPaymentDates';
import { BANI_PROVIDER_ID } from './internalBudgetEstimate';
const context = (admin = false): AssistantProjectContext => ({
  projectId: 'p', projectName: 'Proyecto ficticio', userEmail: 'producer@example.test',
  capabilities: buildAssistantCapabilities({ projectId: 'p', userId: 'producer', globalRole: admin ? 'admin' : 'colaborador', activeAreas: ['Arte'], categories: ['Arte', 'Campo'], collaborator: { role: 'jefe_produccion', allowedTabs: ['areas'], allowedCategories: ['Arte'], canEditBudgetAreas: true, excludedSubcategories: ['Arte||Secreta'] } }),
  activeAreas: ['Arte'], categories: ['Arte', 'Campo'], meta: {}, cashMovements: [], collaborators: [], documents: [],
  budgetItems: [{ id: 'b', area: 'Campo', providerName: 'Principal', description: 'Presupuesto', total: 20 }, { id: 'mirror', area: 'Arte', providerName: 'Duplicado', total: 99 }],
  areaExpenses: [{ id: 'one', area: 'Arte', subcategory: 'General', providerName: 'Persona Uno', description: 'Servicio', total: 10 }, { id: 'two', area: 'Arte', subcategory: 'General', providerName: 'Persona Dos', total: 30, paymentHistory: [{ amount: 5 }] }, { id: 'secret', area: 'Arte', subcategory: 'Secreta', providerName: 'Reservado' }, { id: 'estimate', area: 'Arte', providerId: BANI_PROVIDER_ID, economicNature: 'internal_estimate' } as any],
});
test('un productor prepara distintas fechas con nombres reales del contexto, sin tocar pagos', () => {
  const c = context(), before = JSON.stringify(c);
  const plan = preparePaymentDatePlan(c, { fecha: '2026-11-20', asignaciones: [{ fila: 'one' }, { fila: 'two', fecha: '2026-11-25' }] });
  assert.deepEqual(plan.targets.map(row => row.date), ['2026-11-20', '2026-11-25']);
  assert.match(plan.summary, /Persona Uno · Servicio: 20\/11\/2026/); assert.match(plan.summary, /Persona Dos: 25\/11\/2026/);
  assert.equal(JSON.stringify(c), before);
});
test('rechaza lote completo ante una fila sin alcance, origen inactivo, estimación o presupuesto sin permiso', () => {
  for (const fila of ['secret', 'estimate', 'mirror', 'b']) assert.throws(() => preparePaymentDatePlan(context(), { fecha: '2026-11-20', asignaciones: [{ fila: 'one' }, { fila }] }));
  assert.equal(preparePaymentDatePlan(context(true), { fecha: '2026-11-20', asignaciones: [{ fila: 'b', origen: 'budgetItems' }] }).targets[0].source, 'budgetItems');
});
test('rechaza fechas inválidas, filas duplicadas o ambiguas y lotes que exceden el límite', () => {
  for (const fecha of ['mañana', '2026-02-30', '2026-13-01', undefined]) assert.throws(() => preparePaymentDatePlan(context(), { fecha, asignaciones: [{ fila: 'one' }] }));
  assert.throws(() => preparePaymentDatePlan(context(), { fecha: '2026-11-20', asignaciones: [{ fila: 'one' }, { fila: 'one' }] }), /repetido/);
  assert.throws(() => preparePaymentDatePlan(context(), { fecha: '2026-11-20', asignaciones: [{ fila: 'Persona' }] }), /varios gastos/);
  assert.throws(() => preparePaymentDatePlan(context(), { fecha: '2026-11-20', asignaciones: Array(MAX_ASSISTANT_PAYMENT_DATES + 1).fill({ fila: 'one' }) }), /entre 1/);
  assert.throws(() => preparePaymentDatePlan(context(), { fecha: '2026-11-20', asignaciones: [null] }), /Cada asignación/);
});
test('quitar una fecha es explícito; una cuenta de sólo lectura no prepara cambios', () => {
  assert.match(preparePaymentDatePlan(context(), { fecha: '', asignaciones: [{ fila: 'one' }] }).summary, /Sin fecha/);
  const c = context(); c.capabilities.access.canEditBudgetAreas = false;
  assert.throws(() => preparePaymentDatePlan(c, { fecha: '2026-11-20', asignaciones: [{ fila: 'one' }] }), /permiso/);
});

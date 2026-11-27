import assert from 'node:assert/strict';
import test from 'node:test';
import { runAssistantTurn } from './assistantAgent';
import { applyAssistantCashPayment, ASSISTANT_CASH_PAYMENT_TOOL, prepareAssistantCashPayment } from './assistantCashPayment';
import { buildAssistantCapabilities } from './assistantCapabilities';
import type { AssistantProjectContext, AssistantTool } from './assistantTools';

const today = new Date('2026-11-27T15:00:00Z');
const actor = 'area@example.test';
const context = (): AssistantProjectContext => ({
  projectId: 'spot', projectName: 'Spot', userEmail: actor,
  activeAreas: ['Arte'], categories: ['Arte'], meta: {}, budgetItems: [], collaborators: [], documents: [],
  capabilities: buildAssistantCapabilities({ projectId: 'spot', globalRole: 'colaborador', userEmail: actor,
    activeAreas: ['Arte'], categories: ['Arte'],
    collaborator: { role: 'jefe_area', canEditBudgetAreas: true, allowedTabs: ['areas', 'cajas'],
      allowedCategories: ['Arte'], excludedSubcategories: ['Arte||Reservado'] } }),
  areaExpenses: [
    { id: 'decorado', area: 'Arte', subcategory: 'Utilería', providerName: 'Taller', description: 'Decorado', total: 16000 },
    { id: 'oculto', area: 'Arte', subcategory: 'Reservado', total: 16000 },
  ],
  cashMovements: [
    { id: 'entrada', type: 'entrega', cashAccount: 'general', toUserEmail: actor, amount: 15000, status: 'confirmed' },
    { id: 'reserva', type: 'transferencia', cashAccount: 'personal', fromUserEmail: actor, toUserEmail: 'otra@example.test', amount: 3000, status: 'pending' },
    { id: 'otra-caja', type: 'entrega', cashAccount: 'general', toUserEmail: 'otra@example.test', amount: 100000, status: 'confirmed' },
  ],
});
const input = { fila: 'decorado', fecha: '2026-11-26', monto: 10500.25, detalle: 'Rodaje' };

test('la IA prepara proyecto, gasto, importe, fecha y caja; requiere el clic antes de enviar el pago', async () => {
  const ctx = context(), requests: unknown[] = [];
  const plan = prepareAssistantCashPayment(ctx, input, 'draft', today);
  const tool: AssistantTool = {
    name: ASSISTANT_CASH_PAYMENT_TOOL, description: '', parameters: { type: 'object', properties: {} },
    requiresConfirmation: true,
    prepare: async () => ({ args: { paymentId: plan.request.paymentId }, summary: plan.summary }),
    run: async args => {
      assert.equal(args.paymentId, plan.request.paymentId);
      return applyAssistantCashPayment(plan, ctx, async payload => { requests.push(payload); });
    },
  };
  const turn = await runAssistantTurn({
    history: [], userText: 'Registrá el pago de ayer con mi caja', tools: [tool],
    callModel: async () => ({ message: { role: 'assistant', content: '',
      tool_calls: [{ id: 'call', type: 'function', function: { name: tool.name, arguments: '{}' } }] } }),
  });
  assert.deepEqual(requests, []);
  assert.match(turn.pending!.summary, /Taller · Decorado/);
  assert.match(turn.pending!.summary, /10\.500,25/);
  assert.match(turn.pending!.summary, /26\/11\/2026/);
  assert.match(turn.pending!.summary, /tu caja asignada.*12\.000,00 disponibles/);
  const result = await tool.run(turn.pending!.args) as { mensaje: string };
  assert.match(result.mensaje, /registrado con tu caja de Spot/);
  assert.deepEqual(requests, [plan.request]);
  assert.equal(plan.request.cashAccount, 'personal');
  assert.equal(plan.request.date, '2026-11-26T15:00:00.000Z');
});

test('rechaza gastos ajenos, fechas futuras o inexistentes, pagos de tercero y cajas sin fondos propios', () => {
  for (const fila of ['oculto', 'inexistente']) assert.throws(() => prepareAssistantCashPayment(context(), { ...input, fila }, 'p', today), /puedas editar/);
  for (const fecha of ['2026-02-30', '2026-11-28', undefined]) assert.throws(() => prepareAssistantCashPayment(context(), { ...input, fecha }, 'p', today), /fecha real/);
  for (const monto of [0, 0.000001, 100.123]) assert.throws(() => prepareAssistantCashPayment(context(), { ...input, monto }, 'p', today), /importe pagado/);
  assert.throws(() => prepareAssistantCashPayment(context(), { ...input, monto: 12000.01 }, 'p', today), /tu caja/);
  const ctx = context();
  ctx.areaExpenses[0].thirdPartyPayoutRequired = true;
  assert.throws(() => prepareAssistantCashPayment(ctx, input, 'p', today), /persona autorizada/);
  ctx.areaExpenses[0].thirdPartyPayoutRequired = false;
  ctx.areaExpenses[0].paid = true;
  assert.throws(() => prepareAssistantCashPayment(ctx, input, 'p', today), /saldo pendiente/);
});

test('al confirmar revalida permisos y cambios de fila y deja que el servidor resuelva el mismo ID de reintento', async () => {
  const ctx = context(), plan = prepareAssistantCashPayment(ctx, input, 'draft', today);
  const unexpected = async () => assert.fail('El pago quedó bloqueado antes de escribir');
  ctx.capabilities.access.canEditBudgetAreas = false;
  await assert.rejects(applyAssistantCashPayment(plan, ctx, unexpected), /puedas editar/);
  ctx.capabilities.access.canEditBudgetAreas = true;
  ctx.areaExpenses[0].paymentHistory = [{ id: 'otro', amount: 100 }];
  await assert.rejects(applyAssistantCashPayment(plan, ctx, unexpected), /pagos cambiaron/);
  ctx.areaExpenses[0].paymentHistory = [];
  ctx.cashMovements[0].amount = 10000;
  await assert.rejects(applyAssistantCashPayment(plan, ctx, unexpected), /saldo disponible/);
  ctx.areaExpenses[0].paymentHistory = [{ id: 'draft', amount: input.monto }];
  await applyAssistantCashPayment(plan, ctx, async request => assert.equal(request.paymentId, 'draft'));
});

import { canAssistantManagePayment } from './assistantCapabilities';
import type { AssistantAreaExpense, AssistantProjectContext } from './assistantTools';
import { calculateCashBoxSummaries } from './cashBoxes';
import { normalizeEmail } from './identity';
import { isInternalBudgetEstimate } from './internalBudgetEstimate';

export const ASSISTANT_CASH_PAYMENT_TOOL = 'registrar_pago_mi_caja';
const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
const argentinaDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
});
const cents = (value: number) => Math.round(value * 100);
const payHistory = (item: AssistantAreaExpense) => Array.isArray(item.paymentHistory) ? item.paymentHistory : [];
const paymentHistoryKey = (item: AssistantAreaExpense) => JSON.stringify(
  payHistory(item).map(payment => [payment?.id, payment?.amount]),
);
const paymentTarget = ({ id, area, subcategory, providerId, providerName, description, unit, quantity, unitPrice, total }: AssistantAreaExpense) =>
  ({ id, area, subcategory, providerId, providerName, description, unit, quantity, unitPrice, total });
type PaymentRequest = {
  action: 'registerScopedAreaExpensePayment'; projectId: string; itemId: string; paymentId: string;
  expected: ReturnType<typeof paymentTarget>; amount: number; detail: string; date: string;
  method: 'caja_efectivo'; cashAccount: 'personal';
};
export type AssistantCashPaymentPlan = {
  request: PaymentRequest; ownerEmail: string; paymentHistoryKey: string; summary: string; resultMessage: string;
};

function editableWork(context: AssistantProjectContext, id: string) {
  const item = context.areaExpenses.find(row => row.id === id);
  if (!item || !context.activeAreas.includes(item.area) || !context.capabilities.tabs.includes('areas')
    || !canAssistantManagePayment(context.capabilities, 'areaExpenses', item) || isInternalBudgetEstimate(item))
    throw Error('Elegí un gasto de Áreas que puedas editar en este proyecto.');
  if (item.thirdPartyPayoutRequired) throw Error('Este gasto requiere pagar a la persona autorizada. Abrí Gestión de pagos para revisarlo.');
  return item;
}

function availableCash(context: AssistantProjectContext) {
  const balance = calculateCashBoxSummaries(context.cashMovements).get(normalizeEmail(context.userEmail))?.available || 0;
  return cents(balance);
}

export function prepareAssistantCashPayment(
  context: AssistantProjectContext,
  input: { fila?: unknown; monto?: unknown; fecha?: unknown; detalle?: unknown },
  paymentId: string,
  now = new Date(),
): AssistantCashPaymentPlan {
  const ownerEmail = normalizeEmail(context.userEmail);
  if (!ownerEmail) throw Error('Iniciá sesión para usar tu caja del proyecto.');
  const id = typeof input.fila === 'string' ? input.fila.trim() : '';
  const item = editableWork(context, id);
  const amount = typeof input.monto === 'number' ? input.monto : NaN;
  if (!Number.isFinite(amount) || cents(amount) <= 0 || amount > 1e12 || Math.abs(amount * 100 - cents(amount)) > 0.0001)
    throw Error('Indicá el importe pagado en pesos con hasta dos decimales.');
  const day = typeof input.fecha === 'string' ? input.fecha : '';
  const date = new Date(`${day}T12:00:00-03:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(date.getTime()) || argentinaDate.format(date) !== day || day > argentinaDate.format(now))
    throw Error('Indicá la fecha real del pago (AAAA-MM-DD, hoy o una fecha anterior).');
  const detail = typeof input.detalle === 'string' ? input.detalle.trim() : '';
  if (detail.length > 2000) throw Error('El detalle puede tener hasta 2.000 caracteres.');
  const amountCents = cents(amount);
  const total = Number(item.total);
  const payments = payHistory(item);
  if (!Number.isFinite(total) || payments.some(payment => !Number.isFinite(Number(payment?.amount)) || Number(payment.amount) < 0))
    throw Error('Revisá el historial del gasto antes de registrar otro pago.');
  const pendingCents = cents(total) - payments.reduce((sum, payment) => sum + cents(Number(payment.amount)), 0);
  if (item.paid || amountCents > pendingCents) throw Error('El importe supera el saldo pendiente del gasto. Revisá su historial antes de continuar.');
  const availableCents = availableCash(context);
  if (amountCents > availableCents) throw Error('El importe supera el saldo disponible de tu caja de este proyecto.');
  const pendingAfter = (pendingCents - amountCents) / 100;
  const label = [item.providerName, item.description].filter(Boolean).join(' · ') || item.id;
  const summary = [
    context.projectName, `Gasto: ${label}`, `Área: ${[item.area, item.subcategory].filter(Boolean).join(' · ')}`, `Importe: ${money.format(amount)}`,
    `Fecha del pago: ${day.split('-').reverse().join('/')}`,
    `Caja: tu caja asignada · ${money.format(availableCents / 100)} disponibles`,
    `Saldo del gasto después del pago: ${money.format(pendingAfter)}`,
    ...(detail ? [`Detalle: ${detail}`] : []), 'Comprobante: sin adjunto.',
  ].join('\n');
  return {
    request: { action: 'registerScopedAreaExpensePayment', projectId: context.projectId, itemId: item.id, expected: paymentTarget(item),
      paymentId, amount, detail, date: date.toISOString(), method: 'caja_efectivo', cashAccount: 'personal' },
    ownerEmail, paymentHistoryKey: paymentHistoryKey(item), summary,
    resultMessage: `Pago de ${money.format(amount)} registrado con tu caja de ${context.projectName} para ${label}.`,
  };
}

export async function applyAssistantCashPayment(
  plan: AssistantCashPaymentPlan,
  context: AssistantProjectContext,
  request: (input: PaymentRequest) => Promise<unknown>,
) {
  if (context.projectId !== plan.request.projectId || normalizeEmail(context.userEmail) !== plan.ownerEmail)
    throw Error('Cambió la sesión o el proyecto. Volvé a preparar el pago.');
  const item = editableWork(context, plan.request.itemId);
  // La callable reconoce un reintento por su ID y vuelve a verificar el autor.
  if (!payHistory(item).some(payment => payment?.id === plan.request.paymentId)) {
    if (JSON.stringify(paymentTarget(item)) !== JSON.stringify(plan.request.expected)
      || paymentHistoryKey(item) !== plan.paymentHistoryKey || item.paid)
      throw Error('El gasto o sus pagos cambiaron. Volvé a preparar el pago con el saldo actual.');
    if (cents(plan.request.amount) > availableCash(context))
      throw Error('Cambió el saldo disponible de tu caja y ya no cubre este pago.');
  }
  await request(plan.request);
  return { ok: true, mensaje: plan.resultMessage };
}

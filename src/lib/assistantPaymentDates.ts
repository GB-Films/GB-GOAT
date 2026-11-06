import { doc, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore';
import type { AssistantProjectContext } from './assistantTools';
import { canAssistantEditSubcategory } from './assistantCapabilities';
import { isInternalBudgetEstimate } from './internalBudgetEstimate';

export const MAX_ASSISTANT_PAYMENT_DATES = 200;
type Source = 'budgetItems' | 'areaExpenses';
type DateTarget = { id: string; source: Source; date: string; expected: string; label: string };
export type PaymentDatePlan = { projectId: string; projectName: string; targets: DateTarget[]; summary: string };
const fail = (message: string): never => { throw new Error(message); };
const label = (item: any) => [item.providerName, item.description].filter(Boolean).join(' · ') || item.id;
const version = (item: any) => JSON.stringify([item.updatedAt || null, item.area || '', item.subcategory || '', item.providerId || '', item.providerName || '', item.description || '', item.total || 0, item.paymentDate || '', item.paymentHistory || [], item.paid || false, item.paymentLocked || false]);
const managed = (source: Source, item: any, activeAreas: string[]) => source === 'areaExpenses' ? activeAreas.includes(item.area) : !activeAreas.includes(item.area);
const allowed = (context: AssistantProjectContext, source: Source, item: any) => !isInternalBudgetEstimate(item)
  && managed(source, item, context.activeAreas)
  && (source === 'budgetItems' ? context.capabilities.can.editMainBudget : context.capabilities.isProjectAdmin || canAssistantEditSubcategory(context.capabilities, item.area, item.subcategory));
const validDate = (value: unknown) => typeof value === 'string' && (value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);

export function preparePaymentDatePlan(context: AssistantProjectContext, input: any): PaymentDatePlan {
  if (!Array.isArray(input?.asignaciones) || !input.asignaciones.length || input.asignaciones.length > MAX_ASSISTANT_PAYMENT_DATES)
    fail(`Elegí entre 1 y ${MAX_ASSISTANT_PAYMENT_DATES} gastos por vez.`);
  const all = [...context.budgetItems.map(item => ({ item, source: 'budgetItems' as const })), ...context.areaExpenses.map(item => ({ item, source: 'areaExpenses' as const }))]
    .filter(row => managed(row.source, row.item, context.activeAreas) && !isInternalBudgetEstimate(row.item));
  const used = new Set<string>();
  const targets = input.asignaciones.map((entry: any) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('Cada asignación debe indicar un gasto y una fecha.');
    const date = entry.fecha ?? input.fecha;
    if (!validDate(date)) fail('Usá fechas reales con formato AAAA-MM-DD. Para quitar una fecha, indicá una cadena vacía.');
    const ref = typeof entry.fila === 'string' ? entry.fila.trim() : '';
    if (!ref) fail('Cada fecha debe indicar el gasto al que corresponde.');
    if (entry.origen && !['budgetItems', 'areaExpenses'].includes(entry.origen)) fail('El origen debe ser budgetItems o areaExpenses.');
    const candidates = all.filter(row => !entry.origen || row.source === entry.origen);
    let matches = candidates.filter(row => row.item.id === ref);
    if (!matches.length) matches = candidates.filter(row => [row.item.providerName, row.item.description].some(v => String(v || '').trim().toLocaleLowerCase('es').includes(ref.toLocaleLowerCase('es'))));
    if (matches.length !== 1) fail(matches.length ? `Hay varios gastos que coinciden con «${ref}». Indicá el id y el origen de cada uno.` : `No encontré un gasto vigente que coincida con «${ref}».`);
    const { item, source } = matches[0];
    if (!allowed(context, source, item)) fail(`No tenés permiso para programar la fecha de «${label(item)}».`);
    const key = `${source}/${item.id}`;
    if (used.has(key)) fail(`El gasto «${label(item)}» está repetido. Dejá una sola fecha por gasto.`);
    used.add(key);
    return { id: item.id, source, date, expected: version(item), label: label(item) };
  });
  return { projectId: context.projectId, projectName: context.projectName, targets,
    summary: `Programar fechas en ${context.projectName} (${targets.length} gastos):\n${targets.map(row => `• ${row.label}: ${row.date ? row.date.split('-').reverse().join('/') : 'Sin fecha'}`).join('\n')}` };
}

export async function applyPaymentDatePlan(db: Firestore, plan: PaymentDatePlan, context: AssistantProjectContext) {
  if (context.projectId !== plan.projectId || !plan.targets.length || plan.targets.length > MAX_ASSISTANT_PAYMENT_DATES) fail('Volvé a preparar la programación.');
  const changed = await runTransaction(db, async tx => {
    const project = await tx.get(doc(db, 'projects', plan.projectId));
    if (!project.exists()) fail('El proyecto ya no está disponible.');
    const snapshots = await Promise.all(plan.targets.map(target => tx.get(doc(db, 'projects', plan.projectId, target.source, target.id))));
    let count = 0;
    for (let index = 0; index < snapshots.length; index++) {
      const snapshot = snapshots[index], target = plan.targets[index];
      if (!snapshot.exists() || version(snapshot.data()) !== target.expected) fail(`Cambió el gasto «${target.label}». No se aplicó el lote; revisalo y preparalo nuevamente.`);
      if (!managed(target.source, snapshot.data(), project.data().activeAreas || []) || !allowed(context, target.source, snapshot.data())) fail('Cambió la gestión o el permiso de un gasto. No se aplicó el lote.');
    }
    snapshots.forEach((snapshot, index) => {
      if ((snapshot.data().paymentDate || '') === plan.targets[index].date) return;
      tx.update(snapshot.ref, { paymentDate: plan.targets[index].date, updatedAt: serverTimestamp() });
      count++;
    });
    return count;
  });
  return { ok: true, fechasActualizadas: changed, gastosSeleccionados: plan.targets.length, mensaje: 'Fechas programadas. No se registraron pagos ni movimientos de caja.' };
}

export type AreaStructureChange = {
  kind: 'expense' | 'subcategory'; fromArea: string; fromSubcategory: string; targetArea: string; targetSubcategory: string;
  itemId?: string; beforeExpenseId?: string; beforeSubcategory?: string | null;
  budget?: { assigned: boolean; amount: number; notes: string; expected: string };
};
export const areaGroupBudgetVersion = (entry: any) => JSON.stringify(entry === undefined ? null : [
  typeof entry === 'number' ? true : entry?.budgetAssigned !== false,
  typeof entry === 'number' ? entry : Number(entry?.budget) || 0,
  typeof entry === 'number' ? '' : entry?.notes || '',
]);
type StructureInput = AreaStructureChange & { action: 'reclassifyAreaExpenses'; projectId: string; expectedRevision: number };
export type AreaStructureAttempt = { operationId: string; input: StructureInput };

export async function runAreaStructureChange({ input, attempts, call, refresh, applyCommitted, onRefreshError, newId = () => crypto.randomUUID() }: {
  input: StructureInput;
  attempts: Map<string, AreaStructureAttempt>; call: (input: Record<string, unknown>) => Promise<unknown>;
  refresh: () => Promise<void>; onRefreshError: () => void; newId?: () => string;
  applyCommitted?: (result: any) => boolean;
}) {
  const key = JSON.stringify({ ...input, expectedRevision: 0 });
  const attempt = attempts.get(key) || { operationId: newId(), input: { ...input, ...(input.budget ? { budget: { ...input.budget } } : {}) } };
  attempts.set(key, attempt);
  let result: any;
  try { result = await call({ ...attempt.input, operationId: attempt.operationId }); }
  catch (error) {
    const code = (error as { code?: string })?.code;
    if (code && ['functions/failed-precondition', 'functions/permission-denied', 'functions/invalid-argument', 'functions/not-found'].includes(code)) attempts.delete(key);
    throw error;
  }
  try {
    if (applyCommitted?.(result)) { attempts.delete(key); return; }
  } catch { /* Recover the acknowledged state through the live/server refresh below. */ }
  // A refresh failure must not masquerade as a failed write or roll back the UI.
  // Reusing this attempt retrieves the existing audit rather than moving twice.
  try { await refresh(); attempts.delete(key); } catch { onRefreshError(); }
}

export const areaStructureErrorMessage = (error: unknown) => {
  const e = error as { code?: string; message?: string };
  return e?.code && ['functions/failed-precondition', 'functions/permission-denied', 'functions/invalid-argument'].includes(e.code)
    ? e.message || 'No se pudo cambiar la ubicación. Actualizá la página.'
    : 'No se pudo confirmar el cambio. Revisá la conexión y volvé a intentar; si ya se guardó, no se repetirá.';
};

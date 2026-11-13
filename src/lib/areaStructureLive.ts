import type { AreaStructureChange } from './areaStructureChanges';
export type AreaLocation = { area: string; subcategory: string; order: number; areaStructureRevision?: number };
export type AreaLocationChange = { id: string; after: AreaLocation | null };
export type AreaStructureView = { project: { budgetRevision: number; areaExpenseSubcategories: Record<string, string[]>; areaExpenseSubcategoryBudgets: Record<string, any> }; expenses: AreaLocationChange[] };
const clean = (v: unknown) => String(v || '').trim() === 'Sin subcategoria' ? '' : String(v || '').trim();
const time = (v: any) => v?.toMillis?.() || (v?.seconds ? v.seconds * 1000 : Date.parse(v || '')) || 0;
export const compareManualAreaExpenses = (a: any, b: any) => (Number(a.order) || 0) - (Number(b.order) || 0)
  || time(a.createdAt) - time(b.createdAt) || String(a.id).localeCompare(String(b.id));
export function optimisticAreaExpenseMove(rows: any[], change: AreaStructureChange): AreaLocationChange[] {
  if (change.kind !== 'expense') return [];
  const moving = rows.find(row => row.id === change.itemId);
  if (!moving || moving.area !== change.fromArea || clean(moving.subcategory) !== clean(change.fromSubcategory)) return [];
  const group = (area: string, subcategory: string) => rows.filter(row => row.id !== moving.id && row.area === area && clean(row.subcategory) === clean(subcategory)).sort(compareManualAreaExpenses);
  const source = group(change.fromArea, change.fromSubcategory), same = change.fromArea === change.targetArea && clean(change.fromSubcategory) === clean(change.targetSubcategory);
  const target = same ? source : group(change.targetArea, change.targetSubcategory);
  const index = change.beforeExpenseId ? target.findIndex(row => row.id === change.beforeExpenseId) : target.length;
  if (index < 0) return [];
  target.splice(index, 0, moving);
  return [...(!same ? source.map((row, order) => ({ id: row.id, after: { area: change.fromArea, subcategory: clean(change.fromSubcategory), order } })) : []),
    ...target.map((row, order) => ({ id: row.id, after: { area: change.targetArea, subcategory: clean(change.targetSubcategory), order } }))];
}
// Apply classification only; a concurrent payment or attachment stays intact.
export function applyAreaLocations<T extends { id: string }>(rows: T[], changes: AreaLocationChange[]): T[] {
  const byId = new Map(changes.map(change => [change.id, change.after]));
  return rows.filter(row => byId.get(row.id) !== null).map(row => {
    const next = byId.get(row.id);
    return next ? { ...row, area: next.area, subcategory: next.subcategory, order: next.order,
      ...(next.areaStructureRevision !== undefined ? { areaStructureRevision: next.areaStructureRevision } : {}) } : row;
  });
}
export function reconcileAreaExpenseSnapshot<T extends { id: string; areaStructureRevision?: number }>(current: T[], incoming: T[]): T[] {
  const previous = new Map(current.map(row => [row.id, row]));
  return incoming.map(row => {
    const known = previous.get(row.id) as any;
    return known && (Number(known.areaStructureRevision) || 0) > (Number(row.areaStructureRevision) || 0)
      ? { ...row, area: known.area, subcategory: known.subcategory, order: known.order, areaStructureRevision: known.areaStructureRevision } : row;
  });
}
const structuralFields = ['budgetRevision', 'activeAreas', 'categories', 'categoryBudgets', 'areaExpenseSubcategories', 'areaExpenseSubcategoryBudgets'] as const;
export function liveAreaProjectPatch(data: any) {
  return Object.fromEntries(structuralFields.map(key => [key, data?.[key] ?? (key === 'budgetRevision' ? 0 : key === 'categories' ? undefined : key === 'activeAreas' ? [] : {})]));
}

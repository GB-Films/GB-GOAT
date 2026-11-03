import { effectiveBudgetEstimates } from './internalBudgetEstimate';

export function categoryBudgetMap(project: any): Record<string, number> {
  const entries = project?.categoryBudgets;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return {};
  return Object.fromEntries(Object.entries(entries).filter((entry): entry is [string, number] => Boolean(entry[0]) && validCategoryBudget(entry[1])));
}

export function validCategoryBudget(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    && Number.isSafeInteger(Math.round(value * 100));
}

export function directCategoryBudget(project: any, area: string): number | null {
  const entries = categoryBudgetMap(project);
  return Object.hasOwn(entries, area) ? entries[area] : null;
}

// An explicit allocation replaces the estimate for that category, never its expenses.
export function resolveCategoryBudget(project: any, area: string, detailedTotal: number): number {
  return directCategoryBudget(project, area) ?? detailedTotal;
}

export function getCategoryBudget(project: any, items: any[], area: string): number {
  return resolveCategoryBudget(project, area, effectiveBudgetEstimates(items)
    .filter(item => item.area === area).reduce((sum, item) => sum + (Number(item.total) || 0), 0));
}

export function getAssignedBudgetTotal(project: any, items: any[], areas?: string[]): number {
  const categories = areas || [...new Set([...items.map(item => item.area).filter(Boolean), ...Object.keys(categoryBudgetMap(project))])];
  return categories.reduce((sum, area) => sum + getCategoryBudget(project, items, area), 0);
}

export function renamedCategoryBudgets(project: any, from: string, to: string) {
  const entries = categoryBudgetMap(project);
  return Object.fromEntries(Object.entries(entries).map(([area, amount]) => [area === from ? to : area, amount]));
}

export function removedCategoryBudgets(project: any, area: string) {
  const entries = categoryBudgetMap(project); delete entries[area]; return entries;
}

export function categoryBudgetExportRows(project: any) {
  return Object.entries(categoryBudgetMap(project)).map(([area, amount]) => ({
    Tipo: 'Asignación global', Area: area, 'Presupuesto asignado': amount,
  }));
}

import { normalizeSearchText } from './identity';

// Rows are already restricted by project/subcategory permissions and their
// expenses filtered by the query. Area selection is only a view preference.
export function searchedExpenseAreas<T extends { area: string; expenses: readonly unknown[]; subcategoryGroups: readonly unknown[] }>(
  rows: readonly T[], selectedAreas: readonly string[], search: string,
): T[] {
  const term = normalizeSearchText(search);
  return rows.filter(row => term
    ? row.expenses.length > 0 || row.subcategoryGroups.length > 0 || normalizeSearchText(row.area).includes(term)
    : selectedAreas.includes(row.area));
}

// Reveal matches without overwriting the user's collapse preferences.
export function expenseGroupCollapsed(saved: boolean | undefined, search: string): boolean {
  return !normalizeSearchText(search) && Boolean(saved);
}

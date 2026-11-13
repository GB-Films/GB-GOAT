export function resolveAreaSelection(visibleAreas: string[], preference: string[] | null): string[] {
  if (preference === null) return visibleAreas;
  if (preference.length === 0) return [];
  const selected = visibleAreas.filter((area) => preference.includes(area));
  return selected.length > 0 ? selected : visibleAreas;
}

export function revealMovedExpenseArea(selection: string[] | null, targetArea: string): string[] | null {
  return selection === null || selection.includes(targetArea) ? selection : [...selection, targetArea];
}

export function resolveAreaSelection(visibleAreas: string[], preference: string[] | null): string[] {
  if (preference === null) return visibleAreas;
  if (preference.length === 0) return [];
  const selected = visibleAreas.filter((area) => preference.includes(area));
  return selected.length > 0 ? selected : visibleAreas;
}

const KEY_PREFIX = 'gb-goat:project-area-selection:v1';

export function areaSelectionPreferenceKey(userId: string, projectId: string): string {
  return `${KEY_PREFIX}:${encodeURIComponent(userId)}:${encodeURIComponent(projectId)}`;
}

export function readAreaSelectionPreference(
  storage: Pick<Storage, 'getItem'> | null,
  userId: string,
  projectId: string,
): string[] | null {
  if (!storage || !userId || !projectId) return null;
  try {
    const raw = storage.getItem(areaSelectionPreferenceKey(userId, projectId));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((area) => typeof area === 'string')) return null;
    return [...new Set(parsed)];
  } catch {
    return null;
  }
}

export function resolveAreaSelection(visibleAreas: string[], preference: string[] | null): string[] {
  if (preference === null) return visibleAreas;
  if (preference.length === 0) return [];
  const selected = visibleAreas.filter((area) => preference.includes(area));
  return selected.length > 0 ? selected : visibleAreas;
}

export function writeAreaSelectionPreference(
  storage: Pick<Storage, 'setItem'> | null,
  userId: string,
  projectId: string,
  selectedAreas: string[],
): void {
  if (!storage || !userId || !projectId) return;
  try {
    storage.setItem(areaSelectionPreferenceKey(userId, projectId), JSON.stringify([...new Set(selectedAreas)]));
  } catch {
    // A blocked/full browser store should not prevent changing the visible areas.
  }
}

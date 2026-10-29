import { providerDisplayName } from './providerConstants';

export type ProviderSortOrder = 'name' | 'registration-desc' | 'registration-asc' | 'updated-desc';

export function providerTimestamp(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;
  try {
    const timestamp = value instanceof Date ? value.getTime()
      : typeof value?.toMillis === 'function' ? value.toMillis()
      : typeof value?.toDate === 'function' ? value.toDate().getTime()
      : typeof value?.seconds === 'number' ? value.seconds * 1000 + (value.nanoseconds || 0) / 1e6
      : typeof value === 'string' || typeof value === 'number' ? new Date(value).getTime()
      : NaN;
    return Number.isFinite(timestamp) && Number.isFinite(new Date(timestamp).getTime()) ? timestamp : null;
  } catch { return null; }
}

export function providerRegistrationLabel(provider: any): string {
  const timestamp = providerTimestamp(provider.createdAt);
  return timestamp === null ? 'Sin fecha de inscripción' : `Inscripción: ${new Date(timestamp).toLocaleDateString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires',
  })}`;
}

export function compareProviderOrder(a: any, b: any, order: ProviderSortOrder, nameOf = providerDisplayName): number {
  if (order !== 'name') {
    const field = order === 'updated-desc' ? 'updatedAt' : 'createdAt';
    const first = providerTimestamp(a[field]), second = providerTimestamp(b[field]);
    // An unknown registration date stays last in either direction; never infer it from an edit.
    if (first === null && second !== null) return 1;
    if (first !== null && second === null) return -1;
    if (first !== null && second !== null && first !== second) return order === 'registration-asc' ? first - second : second - first;
  }
  return nameOf(a).localeCompare(nameOf(b), 'es', { sensitivity: 'base' })
    || String(a.id || '').localeCompare(String(b.id || ''));
}

export function sortProviders<T>(providers: readonly T[], order: ProviderSortOrder): T[] {
  return [...providers].sort((a, b) => compareProviderOrder(a, b, order));
}

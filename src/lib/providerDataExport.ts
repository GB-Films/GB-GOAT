import { inferLegacyIdentifiers, normalizeDigits, normalizeProviderText, providerDisplayName } from './providerConstants';
import { compareProviderOrder, type ProviderSortOrder } from './providerOrdering';

export const PROVIDER_DATA_HEADERS = ['Apellido y nombre', 'DNI', 'CUIL / CUIT', 'Fecha de nacimiento', 'Domicilio', 'Actividad / oficio', 'Teléfono', 'Correo electrónico'];
export const providerPersonalAlias = (provider: any) => String(provider.nickname || provider.apodo || provider.alias || provider.preferredName || '').trim();
const text = (value: unknown) => String(value ?? '').trim();
export const isExportablePerson = (provider: any) => provider.type !== 'empresa' && Boolean(provider.name || provider.lastName || provider.fullName);

export function providerBirthDate(value: any): Date | null {
  if (!value) return null;
  let candidate: Date;
  if (typeof value === 'string') {
    const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
    const local = value.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
    if (iso || local) {
      const [year, month, day] = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : [Number(local![3]), Number(local![2]), Number(local![1])];
      candidate = new Date(Date.UTC(year, month - 1, day));
      if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return null;
    } else return null;
  } else {
    try {
      const date = value instanceof Date ? value : typeof value.toDate === 'function' ? value.toDate() : typeof value.seconds === 'number' ? new Date(value.seconds * 1000) : null;
      if (!date || !Number.isFinite(date.getTime())) return null;
      candidate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    } catch { return null; }
  }
  return candidate.getUTCFullYear() >= 1900 && candidate.getTime() <= Date.now() ? candidate : null;
}

export function providerExportName(provider: any) {
  return provider.lastName ? `${text(provider.lastName)}, ${text(provider.name)}` : providerDisplayName(provider);
}

export function missingProviderInsuranceData(provider: any) {
  const identifiers = inferLegacyIdentifiers(provider);
  return [!/^\d{7,9}$/.test(normalizeDigits(identifiers.dniNormalized)) && 'DNI', !providerBirthDate(provider.birthDate) && 'nacimiento', !text(provider.address) && 'domicilio'].filter(Boolean) as string[];
}

export function searchExportProviders(providers: any[], search: string, selectedIds: readonly string[] = [], order: ProviderSortOrder = 'name') {
  const selected = new Set(selectedIds);
  const term = normalizeProviderText(search);
  const tokens = term.split(' ').filter(Boolean);
  const ranked = providers.filter(provider => isExportablePerson(provider) && !selected.has(provider.id)).map(provider => {
    const names = [providerDisplayName(provider), provider.name, provider.lastName, provider.fullName, providerPersonalAlias(provider), ...(Array.isArray(provider.aliases) ? provider.aliases : [])].map(normalizeProviderText);
    const haystack = names.join(' ');
    const score = !term ? 0 : names.includes(term) ? 0 : names.some(name => name.startsWith(term)) ? 1 : 2;
    return { provider, haystack, score };
  }).filter(row => tokens.every(token => row.haystack.includes(token)));
  return ranked.sort((a, b) => (order === 'name' ? a.score - b.score : 0) || compareProviderOrder(a.provider, b.provider, order, providerExportName)).map(row => row.provider);
}

export function selectedExportProviders(providers: any[], ids: readonly string[], order: ProviderSortOrder = 'name') {
  const byId = new Map(providers.filter(isExportablePerson).map(provider => [provider.id, provider]));
  return [...new Set(ids)].map(id => byId.get(id)).filter(Boolean).sort((a, b) => compareProviderOrder(a, b, order, providerExportName));
}

export function providerDataRow(provider: any): Array<string | Date> {
  const identifiers = inferLegacyIdentifiers(provider);
  const dni = normalizeDigits(identifiers.dniNormalized), cuit = normalizeDigits(identifiers.cuitNormalized);
  return [providerExportName(provider), dni ? /^\d{7,9}$/.test(dni) ? dni : `Revisar: ${dni}` : 'No informado', cuit ? cuit.length === 11 ? cuit : `Revisar: ${cuit}` : 'No informado',
    providerBirthDate(provider.birthDate) || (typeof provider.birthDate === 'string' && provider.birthDate.trim() ? `Revisar: ${provider.birthDate}` : 'No informada'), text(provider.address) || 'No informado',
    text(provider.category === 'Otra' ? provider.categoryOther : provider.category) || 'No informada', text(provider.phone) || 'No informado', text(provider.email || provider.adminEmail) || 'No informado'];
}

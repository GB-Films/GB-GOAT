import type { ProviderSortOrder } from '../lib/providerOrdering';

export function ProviderSortSelect({ value, onChange, disabled = false, includeUpdated = false }: {
  value: ProviderSortOrder;
  onChange: (order: ProviderSortOrder) => void;
  disabled?: boolean;
  includeUpdated?: boolean;
}) {
  return <label className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600">
    Ordenar por
    <select value={value} onChange={event => onChange(event.target.value as ProviderSortOrder)} disabled={disabled}
      className="max-w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 disabled:opacity-40">
      {includeUpdated && <option value="updated-desc">Última actualización</option>}
      <option value="name">Nombre (A–Z)</option>
      <option value="registration-desc">Inscripción: más recientes</option>
      <option value="registration-asc">Inscripción: más antiguas</option>
    </select>
  </label>;
}

import { useState } from 'react';
import { SearchableSelect } from '../../components/SearchableSelect';
import { providerDisplayName } from '../../lib/providerConstants';

export function ProjectKeyContacts({ people, providers, canEdit, onAssign }: {
  people: Array<{ id: string; label: string; provider: any }>;
  providers: any[]; canEdit: boolean; onAssign: (roleId: string, providerId: string) => Promise<void>;
}) {
  const [savingRole, setSavingRole] = useState('');
  const [error, setError] = useState('');
  const assign = async (role: string, providerId: string) => {
    if (!canEdit || savingRole) return;
    setSavingRole(role); setError('');
    try { await onAssign(role, providerId); }
    catch { setError('No se pudo guardar el contacto. Reintentá.'); }
    finally { setSavingRole(''); }
  };
  const options = providers.map(provider => ({ value: provider.id, label: providerDisplayName(provider),
    searchText: [provider.email, provider.adminEmail, provider.phone, provider.dni, provider.cuit].filter(Boolean).join(' '),
  })).sort((a, b) => a.label.localeCompare(b.label, 'es'));
  return <section aria-label="Contactos clave" className="rounded-xl border border-slate-200 bg-white shadow-sm">
    <h3 className="border-b border-slate-100 px-3 py-3 text-sm font-bold">Contactos clave</h3>
    {canEdit && error && <p role="alert" className="px-3 pt-2 text-xs text-red-600">{error}</p>}
    <div className="divide-y divide-slate-100">{people.map(({ id, label, provider }) => <div key={id} className="space-y-2 p-3">
      <div className="flex items-center justify-between gap-2"><span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</span>
        {canEdit && provider && <button type="button" disabled={Boolean(savingRole)} onClick={() => void assign(id, '')}
          aria-label={`Quitar ${label}`} className="text-[10px] font-semibold text-slate-500 underline disabled:opacity-50">Quitar</button>}
      </div>
      {canEdit ? <SearchableSelect label={`Buscar ${label}`} value={provider?.id || ''} disabled={Boolean(savingRole)}
        placeholder="Buscar por nombre, email o documento..." options={options}
        // Clearing the search query must never remove the persisted contact.
        onChange={value => { if (value && value !== provider?.id) void assign(id, value); }} />
        : <p className="text-sm font-bold text-slate-900">{provider ? providerDisplayName(provider) : 'Sin asignar'}</p>}
      {provider && <div className="flex flex-wrap gap-x-3 gap-y-1 break-all text-[11px] text-slate-600">
        <span>Email: {provider.email || provider.adminEmail || '-'}</span><span>Tel: {provider.phone || '-'}</span>
      </div>}
      {savingRole === id && <p role="status" className="text-xs text-slate-500">Guardando contacto...</p>}
    </div>)}</div>
  </section>;
}

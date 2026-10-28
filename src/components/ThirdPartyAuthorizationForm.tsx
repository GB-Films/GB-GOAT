import { useRef, useState } from 'react';
export function ThirdPartyAuthorizationForm({ provider, works, party, onChange, onPrepare, onSave, busy, recovered = false }: {
  provider: any; works: any[]; party: any; onChange: (party: any) => void; onPrepare: (input: any) => Promise<void>;
  onSave?: (input: any) => Promise<void>; busy: boolean; recovered?: boolean;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [saving, setSaving] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const details = () => {
    const account = String(party.account ?? (party.cbu || party.alias || '')).trim();
    return { name: party.name, cuit: party.cuit, holder: party.name, holderCuit: party.cuit,
      cbu: /^\d+$/.test(account) ? account : '', alias: /^\d+$/.test(account) ? '' : account };
  };
  return <form ref={form} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4" onSubmit={event => {
    event.preventDefault(); setError(''); setNotice('');
    if (!party.responsibilityConfirmed) { setError('Confirmá la autorización antes de continuar.'); return; }
    void onPrepare({ ...details(), responsibilityConfirmed: true, roles: ['invoice', 'payment'], workKeys: party.workKeys });
  }}>
    <header className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-bold">Quién factura y cobra por mí</h2>{onSave && <button type="button" disabled={busy || saving} className="rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50" onClick={async () => {
      if (!form.current?.reportValidity()) return;
      setError(''); setNotice(''); setSaving(true);
      try { await onSave(details()); setNotice('Datos guardados para próximas autorizaciones.'); }
      catch (error: any) { setError(error.message || 'No se pudieron guardar los datos.'); }
      finally { setSaving(false); }
    }}>{saving ? 'Guardando…' : 'Guardar datos'}</button>}</header>
    {notice && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}
    {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
    <fieldset disabled={busy || saving} className="space-y-4">
      <div className="grid items-end gap-3 md:grid-cols-[1.4fr_.8fr_1.2fr]">{Object.entries({ name: 'Nombre o razón social', cuit: 'CUIT', account: 'CBU/CVU o alias' }).map(([key, label]) => <label key={key} className="flex min-w-0 flex-col gap-1 text-sm"><span>{label}</span><input required type="text" maxLength={key === 'name' ? 160 : key === 'account' ? 100 : 30}
        className="h-10 w-full rounded-lg border border-slate-300 px-3" value={key === 'account' ? (party.account ?? (party.cbu || party.alias || '')) : party[key] || ''} onChange={event => { setNotice(''); onChange({ ...party, [key]: event.target.value }); }} /></label>)}</div>
      <p className="text-xs text-slate-500">La cuenta debe corresponder al titular de la factura. {recovered ? 'Datos recuperados para esta autorización.' : 'Podés guardar estos datos para otros proyectos.'}</p>
      <p className="text-xs text-slate-500">Tu cuenta propia se conserva: {provider.bankAccount_cbu || provider.bankAccount_alias || 'pendiente de completar'}.</p>
      <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Trabajos que autorizás</legend>{works.map(work => <label key={work.key} className="flex items-start gap-2 rounded-lg border border-slate-100 p-2 text-sm"><input type="checkbox" checked={party.workKeys.includes(work.key)} onChange={event => onChange({ ...party, workKeys: event.target.checked ? [...party.workKeys, work.key] : party.workKeys.filter((key: string) => key !== work.key) })} /><span>{work.projectName} · {work.description}</span></label>)}
        {!works.length && <p className="text-sm text-slate-500">Podés guardar los datos ahora y autorizar los trabajos cuando aparezcan.</p>}</fieldset>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={!!party.responsibilityConfirmed} onChange={event => onChange({ ...party, responsibilityConfirmed: event.target.checked })} /><span>Autorizo a esta persona a facturar y cobrar los trabajos seleccionados, en su cuenta y bajo mi responsabilidad.</span></label>
      <div className="flex flex-wrap items-center gap-3"><button type="submit" disabled={busy || saving || !party.workKeys.length} className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50">Revisar y firmar</button><span className="text-xs text-slate-500">Sólo estos trabajos, hasta que revoques la autorización.</span></div>
    </fieldset>
  </form>;
}
import { useEffect, useState } from 'react';
import { pendingProfileFields, proposedProfileValue } from '../lib/providerProfileForm';
export function ProviderProfileForm({ provider, declarations, labels, draft, onChange, onPrepare, busy, notice = '' }: {
  provider: any; declarations: any[]; labels: Record<string, string>; draft: Record<string, string>;
  onChange: (draft: Record<string, string>) => void; onPrepare: (input: any) => Promise<void>; busy: boolean; notice?: string;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const pending = pendingProfileFields(declarations);
  const value = (key: string) => proposedProfileValue(key, draft, provider, pending);
  const hasBank = !!(value('bankAccount_cbu') || value('bankAccount_alias'));
  const needsConfirmation = hasBank && Object.keys(draft).some(key => ['bankAccount_cbu','bankAccount_alias','name','lastName','businessName'].includes(key));
  useEffect(() => { if (!Object.keys(draft).length) setConfirmed(false); }, [draft]);
  return <form className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4" onSubmit={event => { event.preventDefault(); void onPrepare({ changes: draft, ownAccountConfirmed: confirmed }); }}>
    <h2 className="font-bold">Mis datos</h2>
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {!!Object.keys(pending).length && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Los datos marcados ya fueron enviados y están pendientes de revisión.</p>}
    <fieldset disabled={busy} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">{Object.entries(labels).filter(([key]) => key !== 'bankAccount_holder' && (provider.type === 'empresa' ? !['name','lastName','dni'].includes(key) : key !== 'businessName')).map(([key, label]) => <label key={key} className="text-sm">{label}<input className="mt-1 block w-full rounded border p-2" value={value(key)} readOnly={key === 'email'} onChange={event => { onChange({ ...draft, [key]: event.target.value }); if (['bankAccount_cbu','bankAccount_alias','name','lastName','businessName'].includes(key)) setConfirmed(false); }} />{pending[key] && draft[key] === undefined && <span className="mt-1 block text-xs text-amber-700">Pendiente de revisión</span>}</label>)}</div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>{provider.type === 'empresa' ? 'Confirmo que la cuenta provista pertenece a esta empresa.' : 'Soy titular de la cuenta provista.'}</span></label>
      <p className="text-sm text-slate-500">Identidad, CUIT y cuenta bancaria requieren aprobación administrativa. Tus datos enviados quedan visibles mientras se revisan.</p>
      <button disabled={!Object.keys(draft).length || (needsConfirmation && !confirmed)} className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-40">Revisar cambios y firmar</button>
    </fieldset>
  </form>;
}

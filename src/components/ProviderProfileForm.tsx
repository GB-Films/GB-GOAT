import { useEffect, useState } from 'react';
import { pendingProfileFields, proposedProfileValue } from '../lib/providerProfileForm';
export function ProviderProfileForm({ provider, declarations, labels, draft, onChange, onPrepare, busy, notice = '', confirmationRequired = false, accessEmail = '' }: {
  provider: any; declarations: any[]; labels: Record<string, string>; draft: Record<string, string>;
  onChange: (draft: Record<string, string>) => void; onPrepare: (input: any) => Promise<void>; busy: boolean; notice?: string; confirmationRequired?: boolean; accessEmail?: string;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [dataConfirmed, setDataConfirmed] = useState(false), [emailConfirmed, setEmailConfirmed] = useState(false);
  const pending = pendingProfileFields(declarations);
  const value = (key: string) => proposedProfileValue(key, draft, provider, pending);
  const hasBank = !!(value('bankAccount_cbu') || value('bankAccount_alias'));
  const needsConfirmation = confirmationRequired || hasBank && Object.keys(draft).some(key => ['bankAccount_cbu','bankAccount_alias','name','lastName','businessName'].includes(key));
  useEffect(() => { if (!Object.keys(draft).length) setConfirmed(false); }, [draft]);
  return <form className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4" onSubmit={event => { event.preventDefault();
    if (confirmationRequired && (!confirmed || !dataConfirmed || !emailConfirmed)) return;
    void onPrepare({ changes: confirmationRequired ? { ...Object.fromEntries(Object.entries(pending).map(([key, change]) => [key, change.after])), ...draft } : draft, ownAccountConfirmed: confirmed,
      ...(confirmationRequired ? { confirmProfile: true, dataConfirmed, accessEmailConfirmed: emailConfirmed } : {}) }); }}>
    <h2 className="font-bold">{confirmationRequired ? 'Confirmá tus datos' : 'Mis datos'}</h2>
    {confirmationRequired && <p className="text-sm text-slate-600">Vas a firmar un documento con el detalle completo de esta ficha. Podés corregir los datos antes de continuar.</p>}
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {!!Object.keys(pending).length && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Los datos marcados ya fueron enviados y están pendientes de revisión.</p>}
    <fieldset disabled={busy} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">{Object.entries(labels).filter(([key]) => key !== 'bankAccount_holder' && (provider.type === 'empresa' ? !['name','lastName','dni','birthDate'].includes(key) : key !== 'businessName')).map(([key, label]) => <label key={key} className="text-sm">{label}<input type="text" className="mt-1 block w-full rounded border p-2" value={value(key)} readOnly={key === 'email'} onChange={event => { onChange({ ...draft, [key]: event.target.value }); setDataConfirmed(false); if (['bankAccount_cbu','bankAccount_alias','name','lastName','businessName'].includes(key)) setConfirmed(false); }} />{pending[key] && draft[key] === undefined && <span className="mt-1 block text-xs text-amber-700">Pendiente de revisión</span>}</label>)}</div>
      {confirmationRequired && <><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={dataConfirmed} onChange={event => setDataConfirmed(event.target.checked)} /><span>Revisé los datos de esta ficha y confirmo que son correctos.</span></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={emailConfirmed} onChange={event => setEmailConfirmed(event.target.checked)} /><span>Controlo personalmente la cuenta Google <strong>{accessEmail}</strong> y la uso para gestionar esta ficha.</span></label></>}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>{provider.type === 'empresa' ? 'Confirmo que la cuenta provista pertenece a esta empresa.' : 'Soy titular de la cuenta provista.'}</span></label>
      <p className="text-sm text-slate-500">Identidad, CUIT y cuenta bancaria requieren aprobación administrativa. Tus datos enviados quedan visibles mientras se revisan.</p>
      <button disabled={(!confirmationRequired && !Object.keys(draft).length) || (needsConfirmation && !confirmed) || (confirmationRequired && (!dataConfirmed || !emailConfirmed || !hasBank))} className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-40">{confirmationRequired ? 'Revisar confirmación y firmar' : 'Revisar cambios y firmar'}</button>
    </fieldset>
  </form>;
}

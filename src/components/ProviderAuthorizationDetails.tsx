import { useState } from 'react';
import { Copy, FileCheck2 } from 'lucide-react';
import { downloadPortalFile, portalAdminRequest } from '../lib/providerPortal';
import { isCurrentPayoutAuthorization, type ProviderWorkScope, type WorkAuthorization } from '../lib/providerWorkAuthorizations';

export function ProviderAuthorizationDetails({ authorization: a, providerId, scope, canSeeBankDetails = true, workNames = [] }: {
  key?: string; authorization: WorkAuthorization; providerId: string; scope?: ProviderWorkScope; canSeeBankDetails?: boolean; workNames?: string[];
}) {
  const [copied, setCopied] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const current = isCurrentPayoutAuthorization(a), party = a.content.party;
  const fields = [{ label: 'CUIT', value: party.cuit }, ...(current && canSeeBankDetails
    ? [{ label: 'Titular', value: party.holder || party.name }, { label: 'CBU/CVU', value: party.cbu }, { label: 'Alias', value: party.alias }] : [])];
  return <article className={`min-w-0 space-y-2 rounded-lg border p-3 ${current ? 'border-indigo-200 bg-indigo-50/60' : 'border-slate-200 bg-slate-50'}`}>
    <div><p className="break-words text-xs font-bold text-slate-900">{party.name}</p>
      {!current && <p className="mt-1 text-[11px] text-amber-800">{a.status === 'revoked' ? 'Autorización revocada' : 'Autorización sin vigencia para facturar y cobrar'}</p>}</div>
    {workNames.length > 0 && <ul className="space-y-1 text-[11px] text-slate-600">{workNames.map((name, index) => <li key={index}>{name}</li>)}</ul>}
    {fields.filter(field => field.value).map(field => <div key={field.label} className="flex min-w-0 items-center justify-between gap-2">
      <div className="min-w-0"><p className="text-[9px] font-semibold uppercase text-slate-500">{field.label}</p><p className="break-all text-xs text-slate-800">{field.value}</p></div>
      {canSeeBankDetails && <button type="button" aria-label={`Copiar ${field.label} de ${party.name}`} className="shrink-0 rounded border border-indigo-200 bg-white px-2 py-1.5 text-[10px] font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500" onClick={async () => {
        try { await navigator.clipboard.writeText(field.value); setCopied(field.label); setError(''); }
        catch { setError('No se pudo copiar. Seleccioná el dato y copialo.'); }
      }}><Copy className="mr-1 inline h-3 w-3" />{copied === field.label ? 'Copiado' : 'Copiar'}</button>}
    </div>)}
    {a.canDownload !== false ? <button type="button" disabled={busy} className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:opacity-50" onClick={async () => {
      setBusy(true); setError('');
      try { downloadPortalFile(await portalAdminRequest(scope
        ? { ...scope, action: 'workAuthorizationFile', declarationId: a.id }
        : { action: 'declarationFile', providerId, declarationId: a.id, artifact: 'signed' })); }
      catch (e: any) { setError(e.message || 'No se pudo descargar la declaración. Volvé a intentar.'); }
      finally { setBusy(false); }
    }}><FileCheck2 className="h-3.5 w-3.5" />{busy ? 'Descargando…' : 'Ver declaración firmada'}</button>
      : <p className="text-[10px] text-slate-500">La constancia incluye otros proyectos. Pedila a administración.</p>}
    {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
  </article>;
}

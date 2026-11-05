import { useEffect, useState } from 'react';
import { portalAdminRequest } from '../lib/providerPortal';
import { authorizationWorkNames, type WorkAuthorization } from '../lib/providerWorkAuthorizations';
import { ProviderAuthorizationDetails } from './ProviderAuthorizationDetails';
import { ProviderWorkAuthorization } from './ProviderWorkAuthorization';

export function ProviderAuthorizationsPanel({ providerId, lines, global, canSeeBankDetails = true, initialProjectId }: {
  key?: string; providerId: string; lines: any[]; global: boolean; canSeeBankDetails?: boolean; initialProjectId?: string;
}) {
  const works = lines.filter(line => line.expenseId && line.item?.thirdPartyPayoutRequired);
  const [selection, setSelection] = useState('');
  const [rows, setRows] = useState<WorkAuthorization[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!global) return;
    let active = true;
    setLoading(true); setRows([]); setError('');
    portalAdminRequest({ action: 'authorizations', providerId }).then(r => { if (active) setRows(r.authorizations.map(a => ({ ...a, signedByEmail: a.actor?.email || '', signedAt: a.proof?.signedAt || '' }))); })
      .catch(e => { if (active) setError(e.message || 'No se pudieron consultar las declaraciones.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [providerId, global, revision]);
  const selected = works.find(line => line.id === selection) || works.find(line => line.projectId === initialProjectId) || works[0];
  return <section className="space-y-3 rounded-xl border border-indigo-200 bg-white p-3" aria-label="Declaraciones de facturación y cobro">
    <h3 className="text-sm font-bold text-slate-900">Quién factura y cobra por este proveedor</h3>
    {global ? loading ? <p role="status" className="text-xs text-slate-500">Consultando declaraciones…</p>
      : error ? <div role="alert" className="text-xs text-rose-700"><p>{error}</p><button type="button" className="mt-1 font-semibold underline" onClick={() => setRevision(v => v + 1)}>Volver a intentar</button></div>
      : rows.length ? <div className="grid gap-3 md:grid-cols-2">{rows.map(a => <ProviderAuthorizationDetails key={a.id} authorization={a} providerId={providerId} canSeeBankDetails={canSeeBankDetails} workNames={authorizationWorkNames(a, lines)} />)}</div>
      : <p className="text-xs text-slate-500">No hay declaraciones firmadas de terceros.</p>
      : selected ? <><label className="block text-xs font-medium text-slate-600">Trabajo<select className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-xs" value={selected.id} onChange={e => setSelection(e.target.value)}>{works.map(line => <option key={line.id} value={line.id}>{line.projectName} · {line.description}</option>)}</select></label>
        <ProviderWorkAuthorization key={selected.id} scope={{ projectId: selected.projectId, collectionName: selected.collectionName, itemId: selected.expenseId, providerId }} canSeeBankDetails={canSeeBankDetails} /></>
      : <p className="text-xs text-slate-500">No hay trabajos con una declaración de terceros en los proyectos que podés consultar.</p>}
  </section>;
}

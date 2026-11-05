import { useEffect, useState } from 'react';
import { portalAdminRequest } from '../lib/providerPortal';
import { isCurrentPayoutAuthorization, type ProviderWorkScope, type WorkAuthorization } from '../lib/providerWorkAuthorizations';
import { ProviderAuthorizationDetails } from './ProviderAuthorizationDetails';

export function ProviderWorkAuthorization({ scope, canSeeBankDetails = true }: { key?: string; scope: ProviderWorkScope; canSeeBankDetails?: boolean }) {
  const scopeKey = `${scope.projectId}/${scope.collectionName}/${scope.itemId}/${scope.providerId}`;
  const [state, setState] = useState<{ scopeKey?: string; loading: boolean; error?: string; rows: WorkAuthorization[] }>({ loading: true, rows: [] });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setState({ loading: true, rows: [] });
    portalAdminRequest({ action: 'workAuthorizations', ...scope }).then(r => {
      if (active) setState({ scopeKey, loading: false, rows: r.authorizations });
    }).catch(e => { if (active) setState({ scopeKey, loading: false, rows: [], error: e.message || 'No se pudo consultar la autorización.' }); });
    return () => { active = false; };
  }, [scope.projectId, scope.collectionName, scope.itemId, scope.providerId, revision]);
  const current = state.scopeKey === scopeKey ? state.rows.filter(isCurrentPayoutAuthorization) : [];
  const history = state.scopeKey === scopeKey ? state.rows.filter(a => !isCurrentPayoutAuthorization(a)) : [];
  return <section className="space-y-2 border-t border-indigo-100 pt-3" aria-label="Quién factura y cobra por este trabajo">
    <h4 className="text-xs font-bold text-indigo-900">Quién factura y cobra por este trabajo</h4>
    {state.loading || state.scopeKey !== scopeKey ? <p role="status" className="text-xs text-slate-500">Consultando declaración…</p>
      : state.error ? <div role="alert" className="text-xs text-rose-700"><p>{state.error}</p><button type="button" onClick={() => setRevision(v => v + 1)} className="mt-1 font-semibold underline">Volver a intentar</button></div>
      : <>{current.length !== 1 && <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">{current.length > 1 ? 'Hay más de una autorización vigente para este trabajo. Confirmá cuál corresponde antes de pagar.' : 'No hay una autorización vigente para este trabajo. Pedile al proveedor que la actualice antes de pagar a un tercero.'}</p>}
        {current.map(a => <ProviderAuthorizationDetails key={a.id} authorization={a} providerId={scope.providerId} scope={scope} canSeeBankDetails={canSeeBankDetails && current.length === 1} />)}
        {history.length > 0 && <details className="text-xs"><summary className="cursor-pointer py-1 text-slate-500 hover:text-slate-800">Declaraciones anteriores · {history.length}</summary><div className="mt-2 space-y-2">{history.map(a => <ProviderAuthorizationDetails key={a.id} authorization={a} providerId={scope.providerId} scope={scope} canSeeBankDetails={false} />)}</div></details>}
      </>}
  </section>;
}

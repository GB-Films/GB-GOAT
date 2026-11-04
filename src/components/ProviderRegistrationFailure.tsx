import type { RegistrationFailure } from '../lib/providerRegistrationFlow';

export function ProviderRegistrationFailure({ failure, busy, onVerify, onChoose, onRetry, onReload }: {
  failure: RegistrationFailure; busy?: boolean; onVerify: () => void; onChoose: () => void; onRetry: () => void; onReload: () => void;
}) {
  const action = failure.action === 'verify' ? { label:'Verificar con Google', run:onVerify }
    : failure.action === 'choose' ? { label:'Elegir cuenta Google', run:onChoose }
    : failure.action === 'retry' ? { label:'Reintentar envío', run:onRetry }
    : failure.action === 'reload' ? { label:'Volver a comprobar el enlace', run:onReload } : null;
  return <div className="space-y-3 text-sm">
    <p>{failure.message}</p>
    {action && <button type="button" disabled={busy} onClick={action.run} className="rounded-lg border border-current px-4 py-2 font-semibold transition-colors hover:bg-red-100 disabled:opacity-50">{busy ? 'Verificando…' : action.label}</button>}
    {failure.action === 'portal' && <a href="#/mi-proveedor" className="inline-block rounded-lg border border-current px-4 py-2 font-semibold hover:bg-red-100">Ir a Mi proveedor</a>}
    <details className="text-xs font-normal"><summary className="cursor-pointer">Referencia del error</summary><p className="mt-1 break-all">{failure.reference} · {failure.code}</p></details>
  </div>;
}

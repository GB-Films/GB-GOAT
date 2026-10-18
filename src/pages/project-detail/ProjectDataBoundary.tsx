import type { ReactNode } from 'react';
import { projectLoadStatus, type ProjectLoadState } from '../../lib/projectLoadState';

export function ProjectDataBoundary({ state, scope, onRetry, label = 'Cargando datos de esta sección…', children }: {
  state: ProjectLoadState; scope: string; onRetry: () => void; label?: string; children: ReactNode;
}) {
  const status = projectLoadStatus(state, scope);
  if (status === 'ready') return <>{children}</>;
  return <div role={status === 'error' ? 'alert' : 'status'} className="my-3 rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500">
    <p>{status === 'error' ? state.error : label}</p>
    {status === 'error' && <button type="button" onClick={onRetry} className="mt-3 rounded-lg border border-slate-300 px-3 py-2 font-bold text-slate-700">Volver a intentar</button>}
  </div>;
}

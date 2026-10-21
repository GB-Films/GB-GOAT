import { lazy, Suspense, useState, type ReactNode } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
const ProviderProfileDialog = lazy(() => import('./ProviderProfileDialog'));
export function ProviderProfileButton({ providerId, children }: { providerId: string; children: ReactNode }) {
  const [provider, setProvider] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  return <>
    <button type="button" disabled={loading} title="Ver documento y aplicaciones en la ficha del proveedor" className="rounded border border-emerald-100 bg-emerald-50 px-2 py-1 text-[9px] font-bold text-emerald-700" onClick={async () => {
      setLoading(true); setError('');
      try { const snapshot = await getDoc(doc(db, 'providers', providerId)); if (!snapshot.exists()) throw Error(); setProvider({ ...snapshot.data(), id: snapshot.id }); }
      catch { setError('No se pudo abrir el proveedor.'); } finally { setLoading(false); }
    }}>{loading ? 'Cargando…' : children}</button>
    {error && <span role="alert" className="text-xs text-rose-700">{error}</span>}
    {provider && <Suspense fallback={<span className="text-xs">Cargando ficha…</span>}><ProviderProfileDialog provider={provider} onClose={() => setProvider(null)}/></Suspense>}
  </>;
}

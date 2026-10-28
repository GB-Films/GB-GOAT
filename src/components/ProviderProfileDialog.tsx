import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import { loadProviderDetail } from '../lib/providerDetail';
import { ProviderDetailModal } from './ProviderDetailModal';
import { hasGlobalRole, PROVIDER_ACCESS_ROLES } from '../lib/roles';

export default function ProviderProfileDialog({ provider, onClose, initialProjectId }: { provider: any; onClose: () => void; initialProjectId?: string }) {
  const { profile } = useAuth();
  const [detail, setDetail] = useState<any>({ provider, projects: [], lines: [], totals: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const allowed = hasGlobalRole(profile?.role, PROVIDER_ACCESS_ROLES);
  useEffect(() => {
    let active = true;
    if (!profile || !allowed) return;
    setLoading(true);
    loadProviderDetail(provider, profile).then(value => { if (active) { setDetail(value); setError(''); } })
      .catch(() => { if (active) setError('No se pudo cargar la ficha. Cerrá y volvé a intentar.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [provider.id, profile?.uid, allowed, revision]);
  if (!allowed) return createPortal(<div className="fixed inset-0 z-[500] grid place-items-center bg-white/90"><div className="rounded border bg-white p-6"><p className="text-sm">La ficha completa requiere acceso a Proveedores.</p><button type="button" className="mt-3 text-sm font-bold" onClick={onClose}>Cerrar</button></div></div>, document.body);
  return createPortal(<>
    <ProviderDetailModal detail={detail} loading={(loading || !!error) && !detail.totals} onClose={onClose} initialProjectId={initialProjectId} onChanged={() => setRevision(value => value + 1)} />
    {error && <div role="alert" className="fixed bottom-8 left-1/2 z-[510] -translate-x-1/2 rounded bg-rose-50 p-4 text-rose-800">{error}</div>}
  </>, document.body);
}

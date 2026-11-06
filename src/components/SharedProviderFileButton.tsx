import { useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { openProviderFile, type ProjectDocumentScope } from '../lib/providerFinance';

export function SharedProviderFileButton({ id, scope, label = 'Ver comprobante', className = 'text-xs font-semibold text-blue-700 underline disabled:opacity-50', icon, title }: { id: string; scope: ProjectDocumentScope; label?: string; className?: string; icon?: ReactNode; title?: string }) {
  const [opening, setOpening] = useState(false), [error, setError] = useState('');
  return <span className="inline-flex flex-col gap-1"><button type="button" disabled={opening} className={className} title={title} aria-label={icon ? label : undefined} aria-busy={opening || undefined}
    onClick={async () => { setOpening(true); setError(''); try { await openProviderFile(id, scope); } catch { setError('No se pudo abrir el comprobante.'); } finally { setOpening(false); } }}>{icon ? opening ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : icon : opening ? 'Abriendo…' : label}</button>
    {error && <span role="alert" className="text-xs text-rose-700">{error}</span>}</span>;
}

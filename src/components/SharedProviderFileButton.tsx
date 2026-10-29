import { useState } from 'react';
import { openProviderFile, type ProjectDocumentScope } from '../lib/providerFinance';

export function SharedProviderFileButton({ id, scope, label = 'Ver comprobante' }: { id: string; scope: ProjectDocumentScope; label?: string }) {
  const [opening, setOpening] = useState(false), [error, setError] = useState('');
  return <span className="inline-flex flex-col gap-1"><button type="button" disabled={opening} className="text-xs font-semibold text-blue-700 underline disabled:opacity-50"
    onClick={async () => { setOpening(true); setError(''); try { await openProviderFile(id, scope); } catch { setError('No se pudo abrir el comprobante.'); } finally { setOpening(false); } }}>{opening ? 'Abriendo…' : label}</button>
    {error && <span role="alert" className="text-xs text-rose-700">{error}</span>}</span>;
}

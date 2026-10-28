import { useEffect, useRef, useState } from 'react';
import { portalAdminRequest, downloadPortalFile } from '../../lib/providerPortal';
import { providerDisplayName, inferLegacyIdentifiers } from '../../lib/providerConstants';
import type { CatalogDocument } from '../../lib/projectDocumentCatalog';
import { ProjectContractEditor } from './ProjectContractEditor';
import { ProjectDialog } from './ProjectDialog';

export function ProjectContractDialog({ projectId, document, providers, onClose, onPrepared }: {
  projectId: string; document: CatalogDocument; providers: any[]; onClose: () => void; onPrepared: () => Promise<void>;
}) {
  const [source, setSource] = useState<any>(null), [url, setUrl] = useState(''), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    let active = true, objectUrl = '';
    setSource(null); setUrl(''); setError('');
    portalAdminRequest({ action: 'projectContractSource', projectId, documentId: document.sourceDocumentId }).then(result => {
      if (!active) return;
      objectUrl = downloadPortalFile(result, true); setSource(result); setUrl(objectUrl);
    }).catch(error => { if (active) setError(error.message || 'No pudimos cargar el PDF.'); });
    return () => { active = false; generation.current += 1; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [projectId, document.sourceDocumentId, attempt]);
  if (!source || !url) return <ProjectDialog title="Preparar firma del contrato" onClose={onClose}>{error ? <div role="alert"><p>{error}</p><button type="button" className="mt-3 rounded-lg border px-3 py-2" onClick={() => setAttempt(value => value + 1)}>Volver a cargar</button></div> : <p role="status">Cargando PDF…</p>}</ProjectDialog>;
  return <ProjectContractEditor title={source.title} url={url} initialProviderId={source.providerId}
    initialSigners={source.preparation?.bindings?.map(binding => ({ providerId: binding.providerId, name: binding.name, email: binding.email }))}
    initialFields={source.preparation?.fields} frozen={Boolean(source.preparation)}
    providers={providers.map(provider => ({ providerId: provider.id, name: providerDisplayName(provider), email: String(provider.portalAccessEmail || provider.email || '').trim().toLowerCase(), dni: provider.dni || inferLegacyIdentifiers(provider).dniNormalized }))}
    onClose={onClose} onRetry={() => setAttempt(value => value + 1)} onSubmit={async (providerIds, fields) => {
      const current = generation.current;
      await portalAdminRequest({ action: 'prepareProjectContract', projectId, documentId: document.sourceDocumentId, expectedSha256: source.sha256, providerIds, fields });
      if (current === generation.current) { await onPrepared(); if (current === generation.current) onClose(); }
    }} />;
}

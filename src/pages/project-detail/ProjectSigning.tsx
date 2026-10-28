import { useEffect, useRef, useState } from 'react';
import { downloadPortalFile, portalAdminRequest } from '../../lib/providerPortal';
import type { CatalogDocument } from '../../lib/projectDocumentCatalog';
import { ProjectContractDialog } from './ProjectContractDialog';
import { ProjectSigningPanel, type ProjectSigningDocument, type ProjectSigningState } from './ProjectSigningPanel';

export function ProjectSigning({ projectId, search = '', providers = [], manualDocuments = [], canPrepare = false }: { projectId: string; search?: string; providers?: any[]; manualDocuments?: CatalogDocument[]; canPrepare?: boolean }) {
  const [state, setState] = useState<ProjectSigningState | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<'refresh' | null>(null);
  const [downloading, setDownloading] = useState('');
  const [preparing, setPreparing] = useState<CatalogDocument | null>(null);
  const generation = useRef(0);
  const readVersion = useRef(0);
  const pending = useRef(false);
  const scope = useRef(projectId);
  scope.current = projectId;

  useEffect(() => {
    const current = ++generation.current;
    let polling = false;
    setState(null); setError(''); setNotice(''); setPreparing(null); setDownloading(''); setBusy('refresh'); pending.current = false;
    async function load(initial = false) {
      if (polling || pending.current) return;
      polling = true;
      const version = ++readVersion.current;
      try {
        const next = await portalAdminRequest({ action: 'projectDocuments', projectId });
        if (generation.current === current && readVersion.current === version) { setState(next); setError(''); }
      } catch (error: any) {
        if (generation.current === current && readVersion.current === version) setError(error.message || 'No pudimos consultar las firmas. Reintentá.');
      } finally {
        polling = false;
        if (initial && generation.current === current && readVersion.current === version) setBusy(null);
      }
    }
    void load(true);
    const timer = window.setInterval(() => void load(), 30000);
    return () => { generation.current += 1; window.clearInterval(timer); };
  }, [projectId]);

  async function refresh() {
    if (pending.current || scope.current !== projectId) return;
    const current = generation.current;
    const version = ++readVersion.current;
    pending.current = true; setBusy('refresh'); setError(''); setNotice('');
    try {
      const next = await portalAdminRequest({ action: 'projectDocuments', projectId });
      if (generation.current === current && readVersion.current === version) { setState(next); setNotice('Firmas actualizadas.'); }
    } catch (error: any) {
      if (generation.current === current) setError(error.message || 'No pudimos actualizar las firmas. Reintentá.');
    } finally {
      if (generation.current === current) { pending.current = false; setBusy(null); }
    }
  }

  async function download(document: ProjectSigningDocument, artifact: string) {
    if (downloading) return;
    const current = generation.current;
    setDownloading(`${document.source}:${document.id}:${artifact}`); setError('');
    try {
      const file = await portalAdminRequest({ action: 'projectFile', projectId, documentId: document.id, source: document.source, artifact });
      if (generation.current === current) downloadPortalFile(file);
    } catch (error: any) {
      if (generation.current === current) setError(error.message || 'No pudimos descargar el archivo.');
    } finally { if (generation.current === current) setDownloading(''); }
  }

  return <>
    <ProjectSigningPanel state={state} documents={state?.documents || []} manualDocuments={manualDocuments} search={search} providers={providers}
      busy={busy} downloading={downloading} error={error} notice={notice} onRefresh={refresh} onDownload={download}
      onPrepare={canPrepare ? setPreparing : undefined} />
    {preparing && <ProjectContractDialog projectId={projectId} document={preparing} providers={providers} onClose={() => setPreparing(null)}
      onPrepared={async () => { if (scope.current !== projectId) return; await refresh(); if (scope.current === projectId) setNotice('Contrato disponible para firmar desde la cuenta de cada proveedor.'); }} />}
  </>;
}

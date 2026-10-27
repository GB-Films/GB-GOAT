import { useEffect, useRef, useState } from 'react';
import { downloadPortalFile, portalAdminRequest } from '../../lib/providerPortal';
import { signingDocumentMatchesProvider } from '../../lib/projectDocumentCatalog';
import { openSigningProject } from '../../lib/projectSigningActions';
import { ProjectSigningPanel, type ProjectSigningDocument, type ProjectSigningState } from './ProjectSigningPanel';

export function ProjectSigning({ projectId, search = '', providers = [] }: { projectId: string; search?: string; providers?: any[] }) {
  const [state, setState] = useState<ProjectSigningState | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<'open' | 'refresh' | null>(null);
  const [downloading, setDownloading] = useState('');
  const [fallbackUrl, setFallbackUrl] = useState('');
  const generation = useRef(0);
  const readVersion = useRef(0);
  const pending = useRef(false);

  useEffect(() => {
    const current = ++generation.current;
    let polling = false;
    setState(null); setError(''); setNotice(''); setFallbackUrl(''); setDownloading(''); setBusy('refresh'); pending.current = false;
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
    if (pending.current) return;
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

  async function openSign() {
    if (pending.current) return;
    const current = generation.current;
    readVersion.current += 1;
    pending.current = true; setBusy('open'); setError(''); setNotice(''); setFallbackUrl('');
    try {
      // This also gives the current authorized project administrator access in GB Sign.
      const result = await openSigningProject(projectId, { openWindow: () => window.open('', '_blank'), request: portalAdminRequest,
        isCurrent: () => generation.current === current });
      if (!result) return;
      setState(previous => ({ documents: previous?.documents || [], ...previous, connected: true, url: result.url }));
      if (!result.opened) setFallbackUrl(result.url);
      setNotice('Proyecto listo en GB Sign.');
    } catch (error: any) {
      if (generation.current === current) setError(error.message || 'No pudimos abrir GB Sign. Reintentá.');
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

  return <ProjectSigningPanel state={state} documents={(state?.documents || []).filter(document => signingDocumentMatchesProvider(document, search, providers))}
    busy={busy} downloading={downloading} error={error} notice={notice} onOpen={openSign} onRefresh={refresh} onDownload={download} fallbackUrl={fallbackUrl} />;
}

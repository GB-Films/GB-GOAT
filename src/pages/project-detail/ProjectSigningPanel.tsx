import { ExternalLink, RefreshCw, FileSignature, FileText, Download, LoaderCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

export type ProjectSigningDocument = {
  id: string; source?: string; title: string; providerId?: string; status?: string;
  declarationStatus?: string; artifactsReady?: boolean; fileAvailable?: boolean;
  signatures?: Array<{ email: string; status: string }>;
};
export type ProjectSigningState = { connected?: boolean; url?: string; documents: ProjectSigningDocument[] };
const declarations: Record<string, string> = {
  pending_review: 'Pendiente de aprobación', active: 'Vigente', revoked: 'Revocada', rejected: 'Rechazada', pending_signature: 'Pendiente de firma', preparing: 'Preparando documento',
};

export function ProjectSigningPanel({ state, documents, busy, downloading, error, notice, onOpen, onRefresh, onDownload, fallbackUrl }: {
  state: ProjectSigningState | null; documents: ProjectSigningDocument[]; busy: 'open' | 'refresh' | null;
  downloading: string; error: string; notice: string; onOpen: () => void; onRefresh: () => void;
  onDownload: (document: ProjectSigningDocument, artifact: string) => void; fallbackUrl?: string;
}) {
  return <section aria-label="Firmas de contratos" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><FileSignature className="h-4 w-4 text-blue-600" />Firmas · GB Sign</h3>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onOpen} disabled={Boolean(busy)}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60">
          {busy === 'open' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
          {busy === 'open' ? 'Preparando acceso…' : state?.connected ? 'Abrir GB Sign' : 'Preparar contratos en GB Sign'}
        </button>
        <button type="button" onClick={onRefresh} disabled={Boolean(busy)}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60">
          <RefreshCw className={cn('h-4 w-4', busy === 'refresh' && 'animate-spin')} />{busy === 'refresh' ? 'Actualizando…' : 'Actualizar firmas'}
        </button>
      </div>
    </header>
    {error && <p role="alert" className="mx-4 mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="px-4 pt-3 text-xs text-emerald-700">{notice}</p>}
    {fallbackUrl && <a href={fallbackUrl} target="_blank" rel="noreferrer" className="mx-4 mt-3 inline-flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700">Continuar en GB Sign<ExternalLink className="h-4 w-4" /></a>}
    <div className="divide-y divide-slate-100">{documents.map(document => <article key={`${document.source}-${document.id}`} className="px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="break-words text-sm font-semibold text-slate-900">{document.title}</h4>
          <p className="mt-1 text-xs text-slate-500">{(document.signatures || []).map(signer => `${signer.email} · ${signer.status === 'signed' ? 'Firmó' : 'Pendiente'}`).join(' / ')}</p>
          {document.declarationStatus && <p className="mt-1 text-xs text-slate-500">{declarations[document.declarationStatus] || document.declarationStatus}</p>}
        </div>
        <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', document.status === 'completed' && document.artifactsReady ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800')}>
          {document.status === 'completed' && document.artifactsReady ? 'Firmado' : document.status === 'partially_signed' ? 'Firma parcial' : 'Pendiente de firma'}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">{(document.fileAvailable === false ? [] : ['original', ...(document.artifactsReady ? ['signed', 'certificate'] : [])]).map(artifact => {
        const key = `${document.source}:${document.id}:${artifact}`;
        return <button key={artifact} type="button" disabled={Boolean(downloading)} onClick={() => onDownload(document, artifact)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
          {downloading === key ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : artifact === 'original' ? <FileText className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
          {downloading === key ? 'Descargando…' : artifact === 'original' ? 'Original' : artifact === 'signed' ? 'PDF firmado' : 'Certificado'}
        </button>;
      })}</div>
    </article>)}</div>
    {documents.length === 0 && !error && <p className="px-4 py-6 text-sm text-slate-500">{busy ? 'Consultando firmas…' : 'No hay documentos para firmar en esta selección.'}</p>}
  </section>;
}

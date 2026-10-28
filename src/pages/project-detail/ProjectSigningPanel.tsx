import { RefreshCw, FileSignature, FileText, Download, LoaderCircle, ExternalLink } from 'lucide-react';
import { cn } from '../../lib/utils';
import { matchesSmartSearch } from '../../lib/smartSearch';
import { documentCategory, signingDocumentMatchesProvider, type CatalogDocument } from '../../lib/projectDocumentCatalog';

export type ProjectSigningDocument = {
  id: string; source?: string; title: string; providerId?: string; status?: string;
  sourceDocumentId?: string; providerBindings?: Array<{ providerId: string; name: string; email: string }>;
  declarationStatus?: string; artifactsReady?: boolean; fileAvailable?: boolean;
  signatures?: Array<{ email: string; status: string }>;
};
export type ProjectSigningState = { connected?: boolean; url?: string; documents: ProjectSigningDocument[] };
const declarations: Record<string, string> = {
  pending_review: 'Pendiente de aprobación', active: 'Vigente', revoked: 'Revocada', rejected: 'Rechazada', pending_signature: 'Pendiente de firma', preparing: 'Preparando documento',
};

export function ProjectSigningPanel({ state, documents, manualDocuments = [], search = '', providers = [], busy, downloading, error, notice, onRefresh, onDownload, onPrepare }: {
  state: ProjectSigningState | null; documents: ProjectSigningDocument[]; manualDocuments?: CatalogDocument[]; search?: string; providers?: any[]; busy: 'refresh' | null;
  downloading: string; error: string; notice: string; onRefresh: () => void;
  onDownload: (document: ProjectSigningDocument, artifact: string) => void; onPrepare?: (document: CatalogDocument) => void;
}) {
  const manual = manualDocuments.filter(document => documentCategory(document) === 'contratos');
  const prepared = new Set(documents.map(document => document.sourceDocumentId).filter(Boolean));
  const rows = [
    ...documents.map(signing => ({ id: `sign-${signing.source}-${signing.id}`, signing, manual: signing.sourceDocumentId ? manual.find(document => document.sourceDocumentId === signing.sourceDocumentId) : undefined })),
    ...manual.filter(document => !prepared.has(document.sourceDocumentId)).map(document => ({ id: document.id, manual: document, signing: undefined as ProjectSigningDocument | undefined })),
  ].filter(row => !search.trim() || (row.manual && matchesSmartSearch(search, row.manual.providerName)) || (row.signing && (signingDocumentMatchesProvider(row.signing, search, providers)
    || matchesSmartSearch(search, ...(row.signing.providerBindings || []).map(binding => binding.name)))));
  return <section aria-label="Contratos del proyecto" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
    <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
      <h3 className="text-sm font-semibold text-slate-900">Contratos</h3>
      <button type="button" onClick={onRefresh} disabled={Boolean(busy)}
        className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60">
        <RefreshCw className={cn('h-4 w-4', busy === 'refresh' && 'animate-spin')} />{busy === 'refresh' ? 'Actualizando…' : 'Actualizar firmas'}
      </button>
    </header>
    {error && <p role="alert" className="mx-4 mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="px-4 pt-3 text-xs text-emerald-700">{notice}</p>}
    <div className="divide-y divide-slate-100">{rows.map(row => {
      const document = row.signing;
      const pending = document && !(document.status === 'completed' && document.artifactsReady);
      return <article key={row.id} className="flex flex-wrap items-start justify-between gap-4 px-4 py-4">
        <div className="min-w-0 flex-1">
          <h4 className="break-words text-sm font-semibold text-slate-900">{document?.title || row.manual!.description || row.manual!.fileName}</h4>
          <p className="mt-1 text-xs text-slate-500">{document?.providerBindings?.length ? document.providerBindings.map(binding => binding.name).join(' · ') : row.manual?.providerName || (document?.signatures || []).map(signer => signer.email).join(' · ')}</p>
          <span className={cn('mt-2 inline-block rounded-full px-2.5 py-1 text-xs font-medium', !document ? 'bg-slate-100 text-slate-600' : pending ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700')}>
            {!document ? 'Archivo cargado' : !pending ? 'Firmado' : document.status === 'partially_signed' ? 'Firma parcial' : 'Pendiente de firma'}
          </span>
          {document?.declarationStatus && <p className="mt-1 text-xs text-slate-500">{declarations[document.declarationStatus] || document.declarationStatus}</p>}
          {document && <p className="mt-2 text-xs text-slate-500">{(document.signatures || []).map(signer => `${signer.email} · ${signer.status === 'signed' ? 'Firmó' : 'Pendiente'}`).join(' / ')}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {!document && row.manual?.url && <a href={row.manual.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50">Abrir archivo<ExternalLink className="h-3.5 w-3.5" /></a>}
          {!document && row.manual?.sourceDocumentId && onPrepare && <button type="button" onClick={() => onPrepare(row.manual!)}
            disabled={Boolean(state === null) || Boolean(row.manual.contentType && row.manual.contentType !== 'application/pdf')}
            title={row.manual.contentType && row.manual.contentType !== 'application/pdf' ? 'La firma electrónica requiere un archivo PDF.' : undefined}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"><FileSignature className="h-4 w-4" />Preparar firma</button>}
          {document && (document.fileAvailable === false ? [] : ['original', ...(document.artifactsReady ? ['signed', 'certificate'] : [])]).map(artifact => {
            const key = `${document.source}:${document.id}:${artifact}`;
            return <button key={artifact} type="button" disabled={Boolean(downloading)} onClick={() => onDownload(document, artifact)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              {downloading === key ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : artifact === 'original' ? <FileText className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
              {downloading === key ? 'Descargando…' : artifact === 'original' ? 'Original' : artifact === 'signed' ? 'PDF firmado' : 'Certificado'}
            </button>;
          })}
        </div>
      </article>;
    })}</div>
    {rows.length === 0 && !error && <p className="px-4 py-6 text-sm text-slate-500">{busy ? 'Consultando contratos…' : search ? 'No hay contratos de este proveedor.' : 'Cargá un contrato para preparar su firma o conservar el archivo firmado a mano.'}</p>}
  </section>;
}

import { RefreshCw, FileSignature, FileText, Download, LoaderCircle, ExternalLink, CircleCheck, Clock3, FilePenLine, CircleX } from 'lucide-react';
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
      const complete = document?.status === 'completed' && document.artifactsReady;
      const inactive = document && ['revoked', 'rejected', 'cancelled', 'replaced'].includes(document.declarationStatus || document.status || '');
      const status = !document ? 'No preparado para firmar' : inactive ? declarations[document.declarationStatus || ''] || 'Contrato sin vigencia'
        : complete ? 'Firmado' : document.status === 'partially_signed' ? 'Firma parcial' : document.status === 'completed' ? 'Firmado · PDF pendiente' : 'Pendiente de firma';
      const tooltip = [status, document?.declarationStatus && !inactive ? declarations[document.declarationStatus] || document.declarationStatus : ''].filter(Boolean).join(' · ');
      const StatusIcon = !document ? FilePenLine : inactive ? CircleX : complete ? CircleCheck : Clock3;
      const title = document?.title || row.manual!.description || row.manual!.fileName;
      const associatedProvider = providers.find(provider => provider.id === row.manual?.providerId);
      const emails = [...new Set((document
        ? [...(document.providerBindings || []).map(binding => binding.email), ...(document.signatures || []).map(signer => signer.email)]
        : [associatedProvider?.portalAccessEmail || associatedProvider?.email || '']).map(value => String(value || '').trim().toLowerCase()).filter(Boolean))];
      return <article key={row.id} className="grid items-center gap-2 px-4 py-2.5 lg:grid-cols-[minmax(180px,1fr)_minmax(180px,.8fr)_320px] lg:gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <span role="img" aria-label={tooltip} title={tooltip} tabIndex={0}
            className={cn('shrink-0 cursor-help rounded focus-visible:outline-blue-500', !document ? 'text-blue-600' : inactive ? 'text-red-600' : complete ? 'text-emerald-600' : 'text-amber-500')}>
            <StatusIcon className="h-5 w-5" aria-hidden="true" />
          </span>
          <h4 title={title} className="min-w-0 truncate text-sm font-semibold text-slate-900">{title}</h4>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">{emails.map(email => {
          const signed = document?.signatures?.some(signer => signer.email.trim().toLowerCase() === email && signer.status === 'signed');
          const label = !document ? 'Sin solicitud de firma' : signed ? 'Firmó' : inactive ? 'Solicitud sin vigencia' : 'Pendiente de firma';
          return <span key={email} title={label} aria-label={`${email}: ${label}`} tabIndex={0}
            className={cn('max-w-full cursor-help truncate rounded-full px-2.5 py-1 text-xs focus-visible:outline-blue-500', !document ? 'bg-blue-50 text-blue-700' : signed ? 'bg-emerald-50 text-emerald-700' : inactive ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800')}>{email}</span>;
        })}{emails.length === 0 && row.manual?.providerName && <span className="truncate text-xs text-slate-500" title={row.manual.providerName}>{row.manual.providerName}</span>}</div>
        <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
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

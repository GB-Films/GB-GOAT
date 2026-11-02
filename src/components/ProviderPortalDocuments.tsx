import { CheckCircle2, ChevronRight, Clock3, Download, FileText, FolderOpen, PenLine, RefreshCw } from 'lucide-react';
import { ProviderDeclarationCard } from './ProviderDeclarationCard';
import { declarationDocument, declarationPresentation, portalDeclarationCompletionInput, type DeclarationDocument } from '../lib/providerDeclarationUi';
import { groupPortalDocumentsByProject, needsPortalSignature } from '../lib/providerPortalUi';
import { outdatedProfileDeclaration } from '../lib/providerProfileForm';

export function ProviderPortalDocuments({ documents, declarations, providerId, providerType, provider, busy, loading, loaded, notice, onRefresh, onSign, onDownload, onRecover, onApply, onApplyDocument, onReviewData, onReviewCompany, onRevoke, labels }: {
  documents: any[]; declarations: any[]; providerId: string; providerType: string; provider?: Record<string, unknown>; busy: boolean; loading: boolean; loaded: boolean; notice: string; labels: Record<string, string>;
  onRefresh: () => void; onSign: (doc: any) => void; onDownload: (doc: any, artifact: string) => Promise<void>;
  onRecover: (doc: any) => Promise<void>; onApply: (id: string, kind: string, doc?: DeclarationDocument, recover?: boolean) => Promise<string>;
  onApplyDocument: (doc: any) => Promise<void>;
  onReviewData: () => void; onReviewCompany: () => void; onRevoke: (id: string) => void;
}) {
  const contracts = documents.filter(doc => !declarations.some(d => declarationDocument(d, [doc], providerId)));
  const pending = contracts.filter(needsPortalSignature), remaining = contracts.filter(doc => !needsPortalSignature(doc));
  const declarationCards = declarations.map(d => ({ d, doc: declarationDocument(d, documents, providerId) }));
  const activeDeclarations = declarationCards.filter(({ d, doc }) => !(provider && outdatedProfileDeclaration(d, provider)) && declarationPresentation(d, providerType, doc).action);
  const history = declarationCards.filter(item => !activeDeclarations.includes(item));
  const card = (doc: any) => {
    const pending = needsPortalSignature(doc);
    return <article key={doc.id} className={`portal-panel space-y-4 ${pending ? 'border-amber-200' : ''}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className={`rounded-xl p-2.5 ${pending ? 'bg-amber-50 text-amber-700' : 'bg-slate-50 text-slate-500'}`}><FileText className="h-5 w-5" aria-hidden="true" /></div>
        <div className="min-w-[10rem] flex-1"><h3 className="break-words font-semibold text-slate-900">{doc.title}</h3>
          <p className="mt-1 text-xs text-slate-500">{doc.declarationKind ? 'Declaración' : 'Contrato'}</p></div>
        <span className={`portal-status ${pending ? 'portal-status-pending' : doc.signed ? 'portal-status-signed' : ''}`}>
          {pending ? <Clock3 className="h-3.5 w-3.5" aria-hidden="true" /> : doc.signed ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : null}
          {pending ? 'Pendiente de tu firma' : doc.signed ? 'Firmado por vos' : ({ cancelled: 'Anulado', revoked: 'Revocado', rejected: 'Rechazado', replaced: 'Reemplazado' } as Record<string, string>)[doc.status] || 'Sin firma pendiente'}
        </span>
      </div>
      {doc.signed && (doc.status === 'partially_signed' || !doc.artifactsReady) && <p className="text-sm text-slate-500">{doc.status === 'partially_signed' ? 'Esperando las otras firmas.' : 'El PDF firmado se está preparando.'}</p>}
      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
        {pending && <button disabled={busy} className="portal-button portal-button-primary" onClick={() => onSign(doc)}><PenLine className="h-4 w-4" aria-hidden="true" />Revisar y firmar</button>}
        <button disabled={busy} className="portal-button" onClick={() => void onDownload(doc, 'original')}><FileText className="h-4 w-4" aria-hidden="true" />Original</button>
        {doc.signed && !doc.artifactsReady && <button disabled={busy} className="portal-button" onClick={() => void onRecover(doc)}>Completar PDF firmado</button>}
        {doc.signed && portalDeclarationCompletionInput(doc) && !['applied', 'active', 'rejected', 'revoked'].includes(doc.declarationStatus) && !(doc.declarationKind === 'representation' && doc.declarationVersion !== 'company-representation-v4') && <button disabled={busy} className="portal-button" onClick={() => void onApplyDocument(doc)}>Aplicar declaración firmada</button>}
        {doc.artifactsReady && ['signed', 'certificate'].map(artifact => <button disabled={busy} key={artifact} className="portal-button" onClick={() => void onDownload(doc, artifact)}><Download className="h-4 w-4" aria-hidden="true" />{artifact === 'signed' ? 'PDF firmado' : 'Certificado de evidencia'}</button>)}
        {doc.declarationKind === 'representation' && doc.declarationVersion !== 'company-representation-v4' && providerType === 'empresa' && <button disabled={busy} className="portal-button" onClick={onReviewCompany}>Actualizar representación</button>}
      </div>
    </article>;
  };
  const declarationCard = ({ d, doc }: typeof declarationCards[number]) => <ProviderDeclarationCard key={`${providerId}/${d.id}`} declaration={d} document={doc} providerType={providerType} provider={provider} busy={busy}
    onSign={() => { if (doc) onSign(doc); }} onReviewData={d.kind === 'representation' && providerType === 'empresa' ? onReviewCompany : onReviewData}
    onDownload={artifact => { if (!doc) return Promise.reject(Error('Este documento no está disponible.')); return onDownload(doc, artifact); }}
    onComplete={recover => onApply(d.id, d.kind, doc, recover)}>
    {d.content.changes && <dl className="divide-y divide-slate-100 rounded-xl bg-slate-50 px-3">
      {Object.entries(d.content.changes).map(([key, change]: [string, any]) => <div key={key} className="grid gap-1 py-2 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="text-slate-500">{labels[key] || key}</dt><dd className="break-words text-slate-800">{change.after || 'Sin dato'}</dd>
      </div>)}
    </dl>}
    {d.kind === 'third_party' && <div className="space-y-2 text-sm text-slate-600"><p>{d.content.party.name} · CUIT {d.content.party.cuit}</p>
      <p>{d.content.validity === 'until_revoked' ? 'Hasta que revoques la autorización' : `Vigente hasta ${d.content.expiresOn}`}</p>
      {d.content.party.relationship && <p>Relación con el prestador: {d.content.party.relationship}</p>}
      {d.content.party.activity && <p>Actividad declarada: {d.content.party.activity}</p>}
      <p>Cuenta autorizada: {d.content.party.cbu || d.content.party.alias}</p>
      {['active', 'pending_review'].includes(d.status) && <button disabled={busy} className="portal-button" onClick={() => onRevoke(d.id)}>Revocar autorización</button>}
    </div>}
  </ProviderDeclarationCard>;
  const projects = (items: any[]) => groupPortalDocumentsByProject(items).map(group => <details key={group.key} aria-label={group.name} open={group.documents.some(needsPortalSignature) || undefined} className="group rounded-2xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4">
    <summary className="flex min-h-11 list-none items-center gap-2 rounded-xl px-1 py-1 transition-colors hover:bg-slate-100 [&::-webkit-details-marker]:hidden"><ChevronRight className="h-4 w-4 shrink-0 text-slate-500 transition-transform group-open:rotate-90" aria-hidden="true" /><FolderOpen className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" /><span className="min-w-0 flex-1 break-words font-semibold text-slate-800">{group.name}</span><span className="portal-status">{group.documents.length} {group.documents.length === 1 ? 'documento' : 'documentos'}</span></summary>
    <div className="mt-3 space-y-3">{group.documents.map(card)}</div>
  </details>);
  return <section className="space-y-5" aria-label="Tus documentos">
    <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Tus documentos</h2><p className="mt-1 text-sm text-slate-500">Firmá los pendientes y descargá tus constancias.</p></div>
      <button disabled={busy || loading} className="portal-button" onClick={onRefresh}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />Actualizar</button></div>
    {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {!loaded && loading && <p role="status" className="portal-panel text-sm text-slate-500">Buscando tus documentos…</p>}
    {!!(pending.length || activeDeclarations.length) && <section className="space-y-3" aria-label="Documentos pendientes"><h3 className="text-sm font-semibold text-amber-900">Necesitan tu atención</h3>{projects(pending)}{activeDeclarations.map(declarationCard)}</section>}
    {!!remaining.length && <section className="space-y-3" aria-label="Documentos guardados"><h3 className="text-sm font-semibold text-slate-500">Contratos y constancias</h3>{projects(remaining)}</section>}
    {!!history.length && <details className="portal-details portal-panel"><summary>Historial de declaraciones <span className="ml-2 text-slate-400">{history.length}</span></summary><div className="mt-4 space-y-3">{history.map(declarationCard)}</div></details>}
    {loaded && !documents.length && !declarations.length && <div className="portal-panel py-12 text-center"><FileText className="mx-auto mb-3 h-8 w-8 text-slate-300" aria-hidden="true" /><h3 className="font-medium">Todavía no tenés documentos</h3><p className="mt-1 text-sm text-slate-500">Los documentos que te asignen aparecerán acá.</p></div>}
  </section>;
}

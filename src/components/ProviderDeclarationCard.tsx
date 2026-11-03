import { useRef, useState, type ReactNode } from 'react';
import { declarationPresentation, type DeclarationDocument, type PortalDeclaration } from '../lib/providerDeclarationUi';
import { portalErrorMessage } from '../lib/providerPortalUi';
import { outdatedProfileDeclaration } from '../lib/providerProfileForm';

export function ProviderDeclarationCard({ declaration: d, document: doc, providerType, provider, busy, children, onSign, onComplete, onDownload, onReviewData }: {
  key?: string; declaration: PortalDeclaration; document?: DeclarationDocument; providerType: string; provider?: Record<string, unknown>; busy: boolean; children?: ReactNode;
  onSign: () => void; onComplete: (recover: boolean) => Promise<string>;
  onDownload: (artifact: string) => Promise<void>; onReviewData: () => void;
}) {
  const ui = declarationPresentation(d, providerType, doc);
  if (provider && outdatedProfileDeclaration(d, provider)) { ui.action = null; ui.status = 'Datos anteriores'; ui.explanation = 'Esta firma corresponde a una versión anterior de tu ficha.'; }
  const signedAt = Date.parse(d.signedAt || '');
  const [feedback, setFeedback] = useState(''), [error, setError] = useState(''), [working, setWorking] = useState(false);
  const running = useRef(false);
  async function execute(action: () => Promise<string | void>) {
    if (running.current) return;
    running.current = true; setWorking(true); setError(''); setFeedback('');
    try { const message = await action(); if (message) setFeedback(message); }
    catch (e: any) { setError(portalErrorMessage(e)); }
    finally { running.current = false; setWorking(false); }
  }
  const disabled = busy || working;
  const button = 'portal-button';
  return <article className="portal-panel space-y-3">
    <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{ui.title}</h3><span className={`portal-status ${ui.action === 'sign' ? 'portal-status-pending' : ['applied', 'active'].includes(d.status) ? 'portal-status-signed' : ''}`}>{ui.status}</span></div>
    <p className="text-sm text-slate-600">{ui.explanation}</p>
    {children && <details className="portal-details rounded-xl border border-slate-100 p-3"><summary>Ver detalle de la declaración</summary><div className="mt-3">{children}</div></details>}
    {Number.isFinite(signedAt) && <p className="text-xs text-slate-500">Firmada el {new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Argentina/Buenos_Aires' }).format(signedAt)}</p>}
    {ui.missingDocument && <p className="text-sm text-amber-800">No encontramos un documento de firma disponible para esta solicitud. Volvé a consultar Documentos; si sigue sin aparecer, pedí que revisen esta constancia.</p>}
    <div className="flex flex-wrap gap-3">
      {ui.action === 'sign' && <button type="button" disabled={disabled} className="portal-button portal-button-primary" onClick={onSign}>Revisar y firmar</button>}
      {ui.action && ui.action !== 'sign' && <button type="button" disabled={disabled} className={button} onClick={() => void execute(() => onComplete(ui.action === 'recover'))}>
        {working ? 'Procesando…' : ui.action === 'recover' ? 'Completar PDF y comprobar aplicación' : ui.action === 'prepare' ? 'Recuperar documento para firmar' : 'Comprobar aplicación de la firma'}
      </button>}
      {d.kind === 'profile' && d.owned && d.status !== 'applied' && <button type="button" disabled={disabled} className={button} onClick={onReviewData}>Revisar mis datos actuales</button>}
      {d.kind === 'third_party' && d.owned && d.applicationIssue && <button type="button" disabled={disabled} className={button} onClick={onReviewData}>Actualizar declaración desde Mis datos</button>}
      {d.kind === 'representation' && providerType === 'empresa' && d.owned && d.status === 'pending_review' && <button type="button" disabled={disabled} className={button} onClick={onReviewData}>Completar nueva declaración de representación</button>}
      {doc && <button type="button" disabled={disabled} className={button} onClick={() => void execute(() => onDownload('original'))}>Ver declaración original</button>}
      {doc?.artifactsReady && ['signed', 'certificate'].map(artifact => <button type="button" key={artifact} disabled={disabled} className={button} onClick={() => void execute(() => onDownload(artifact))}>{artifact === 'signed' ? 'PDF firmado' : 'Certificado de evidencia'}</button>)}
    </div>
    {working && <p role="status" className="text-sm text-slate-600">Consultando esta declaración…</p>}
    {feedback && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-900">{feedback}</p>}
    {error && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
  </article>;
}

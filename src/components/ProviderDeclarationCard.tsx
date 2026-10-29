import { useRef, useState, type ReactNode } from 'react';
import { declarationPresentation, type DeclarationDocument, type PortalDeclaration } from '../lib/providerDeclarationUi';

export function ProviderDeclarationCard({ declaration: d, document: doc, providerType, busy, children, onSign, onComplete, onDownload, onReviewData }: {
  key?: string; declaration: PortalDeclaration; document?: DeclarationDocument; providerType: string; busy: boolean; children?: ReactNode;
  onSign: () => void; onComplete: (recover: boolean) => Promise<string>;
  onDownload: (artifact: string) => Promise<void>; onReviewData: () => void;
}) {
  const ui = declarationPresentation(d, providerType, doc);
  const [feedback, setFeedback] = useState(''), [error, setError] = useState(''), [working, setWorking] = useState(false);
  const running = useRef(false);
  async function execute(action: () => Promise<string | void>) {
    if (running.current) return;
    running.current = true; setWorking(true); setError(''); setFeedback('');
    try { const message = await action(); if (message) setFeedback(message); }
    catch (e: any) { setError(e.message || 'No pudimos completar la operación. Intentá nuevamente.'); }
    finally { running.current = false; setWorking(false); }
  }
  const disabled = busy || working;
  const button = 'rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-40';
  return <article className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
    <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{ui.title}</h3><span className="text-sm">{ui.status}</span></div>
    <p className="text-sm text-slate-600">{ui.explanation}</p>
    {children}
    <p className="text-xs text-slate-500">Constancia {d.id}{d.signedAt ? ` · Firma: ${d.signedAt}` : ''}</p>
    {ui.missingDocument && <p className="text-sm text-amber-800">No encontramos un documento de firma disponible para esta solicitud. Volvé a consultar Documentos; si sigue sin aparecer, pedí que revisen esta constancia.</p>}
    <div className="flex flex-wrap gap-3">
      {ui.action === 'sign' && <button type="button" disabled={disabled} className={button} onClick={onSign}>Revisar y firmar</button>}
      {ui.action && ui.action !== 'sign' && <button type="button" disabled={disabled} className={button} onClick={() => void execute(() => onComplete(ui.action === 'recover'))}>
        {working ? 'Procesando…' : ui.action === 'recover' ? 'Completar PDF y comprobar aplicación' : ui.action === 'prepare' ? 'Recuperar documento para firmar' : 'Comprobar aplicación de la firma'}
      </button>}
      {d.kind === 'profile' && d.owned && d.status !== 'applied' && <button type="button" disabled={disabled} className={button} onClick={onReviewData}>Revisar mis datos actuales</button>}
      {doc && <button type="button" disabled={disabled} className="text-sm underline disabled:opacity-40" onClick={() => void execute(() => onDownload('original'))}>Ver declaración original</button>}
      {doc?.artifactsReady && ['signed', 'certificate'].map(artifact => <button type="button" key={artifact} disabled={disabled} className="text-sm underline disabled:opacity-40" onClick={() => void execute(() => onDownload(artifact))}>{artifact === 'signed' ? 'PDF firmado' : 'Certificado de evidencia'}</button>)}
    </div>
    {working && <p role="status" className="text-sm text-slate-600">Consultando esta declaración…</p>}
    {feedback && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-900">{feedback}</p>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
  </article>;
}

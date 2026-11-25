import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, LocateFixed, PenLine, X } from 'lucide-react';
import { normalizeSigningDni, personalSignatureFields, signingFailure, signingFieldChoice, signingNextStep, type PortalSignatureInput } from '../lib/portalSigning';
import { PortalDocumentViewer } from './PortalDocumentViewer';
import { PortalSignatureCanvas } from './PortalSignatureCanvas';

type Props = {
  key?: string;
  document: { title: string; signatureFields?: unknown; requiredDni?: string };
  signer: { email: string; name: string };
  url: string;
  preparing?: boolean;
  loadError: string;
  progress?: string;
  onRetry: () => void;
  onClose: () => void;
  onSubmit: (input: PortalSignatureInput) => Promise<void>;
};

const stages = ['Documento', 'Tus datos', 'Firma'];

export function PortalSigningRoom({ document: doc, signer, url, loadError, progress = '', onRetry, onClose, onSubmit, preparing = false }: Props) {
  const [stage, setStage] = useState(0);
  const [dni, setDni] = useState(doc.requiredDni || '');
  const [name, setName] = useState(signer.name);
  const [dniConfirmed, setDniConfirmed] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'typed' | 'drawn'>('typed');
  const [image, setImage] = useState('');
  const [selectedFieldId, setSelectedFieldId] = useState('');
  const [pageCount, setPageCount] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [viewerError, setViewerError] = useState('');
  const [checkDocuments, setCheckDocuments] = useState(false);
  const [slow, setSlow] = useState(false);
  const [focusFieldRequest, setFocusFieldRequest] = useState<{ id: string; revision: number }>();
  const dialog = useRef<HTMLDivElement>(null);
  const documentSection = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const lastStage = useRef(stage);
  const submitting = useRef(false);

  const fields = useMemo(() => personalSignatureFields(doc.signatureFields, signer.email).filter(field => field.page <= pageCount), [doc.signatureFields, signer.email, pageCount]);
  const selected = signingFieldChoice(fields, selectedFieldId);
  const target = selected || fields[0];
  const cleanDni = normalizeSigningDni(dni);
  const validDni = /^\d{6,12}$/.test(cleanDni) && (!doc.requiredDni || cleanDni === normalizeSigningDni(doc.requiredDni));
  const documentError = loadError || viewerError;
  // The PDF is hidden on mobile after review. Its canvas readiness may drop
  // when hidden, while the reviewed document, field and page count stay valid.
  const next = signingNextStep({ preparing, hasUrl: Boolean(url), loadError: documentError, ready: stage > 0 || ready,
    fieldCount: fields.length, selectedPage: selected?.page, targetPage: target?.page, validDni, dniConfirmed,
    hasSignature: mode === 'drawn' ? Boolean(image) : Boolean(name.trim()), accepted });
  const documentBlocked = ['preparing', 'loading', 'load_error', 'unassigned', 'field'].includes(next.step);
  const canAdvance = stage === 0 ? ready && !documentBlocked : stage === 1 ? !documentBlocked && validDni && dniConfirmed : next.step === 'ready';
  const canSign = stage === 2 && canAdvance && !checkDocuments;

  const complete = checkDocuments || next.step === 'unassigned';
  const retry = next.step === 'load_error' || slow && next.step === 'loading';
  const primaryLabel = busy ? 'Registrando firma…' : complete ? 'Volver a Documentos' : retry ? 'Volver a cargar'
    : stage === 0 ? 'Continuar a mis datos' : stage === 1 ? 'Continuar a firmar' : 'Firmar y confirmar';
  const guidance = busy ? progress || 'Guardando tu firma…'
    : error ? error : documentBlocked ? documentError || next.message
    : stage === 0 ? 'Leé el PDF antes de continuar.'
    : stage === 1 ? !validDni ? 'Ingresá tu DNI.' : !dniConfirmed ? 'Confirmá que el DNI te corresponde.' : ''
    : next.step === 'ready' ? '' : next.message;

  useEffect(() => {
    setSlow(false);
    if (!busy && next.step !== 'loading' && next.step !== 'preparing') return;
    const timer = window.setTimeout(() => setSlow(true), 15000);
    return () => window.clearTimeout(timer);
  }, [busy, next.step, progress, url]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);

  useEffect(() => {
    if (lastStage.current === stage) return;
    lastStage.current = stage;
    (stage === 0 ? documentSection.current : heading.current)?.focus({ preventScroll: true });
    const details = heading.current?.closest('.portal-sign-details');
    if (details) details.scrollTop = 0;
  }, [stage]);

  function showField(field = target) {
    if (field) setFocusFieldRequest(current => ({ id: field.id, revision: (current?.revision || 0) + 1 }));
  }

  async function submit() {
    if (!canSign || !selected || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      await onSubmit({ fieldId: selected.id, dni: cleanDni, typedName: name.trim(), signatureType: mode, signatureImage: mode === 'drawn' ? image : '' });
    } catch (err) {
      const failure = signingFailure(err as { code?: string; message?: string });
      setError(failure.message);
      setCheckDocuments(failure.checkDocuments);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  function continueSigning() {
    if (busy) return;
    if (complete) { onClose(); return; }
    if (retry) { onRetry(); return; }
    if (!canAdvance) return;
    if (stage < 2) setStage(stage + 1);
    else void submit();
  }

  return <div className="portal-sign-backdrop">
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="portal-sign-title" tabIndex={-1} className="portal-sign-dialog portal-sign-room"
      onKeyDown={event => {
        if (event.key === 'Escape' && !submitting.current) { event.stopPropagation(); onClose(); }
        if (event.key === 'Tab') {
          const elements = (Array.from(dialog.current?.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]') || []) as HTMLElement[])
            .filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
          const first = elements[0], last = elements[elements.length - 1];
          const focus = document.activeElement;
          if (event.shiftKey && (focus === first || focus === dialog.current)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && (focus === last || focus === dialog.current)) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <header className="portal-sign-header"><h2 id="portal-sign-title">{doc.title}</h2><button type="button" disabled={busy} aria-label="Cerrar firma" title="Cerrar firma" onClick={onClose}><X size={18} aria-hidden="true" /></button></header>
      <ol className="portal-sign-steps" aria-label="Pasos para firmar">
        {stages.map((label, index) => <li key={label} aria-current={index === stage ? 'step' : undefined} data-complete={index < stage || undefined}>
          <span aria-hidden="true">{index < stage ? <Check size={13} /> : index + 1}</span>{label}
        </li>)}
      </ol>

      <div className="portal-sign-layout" data-stage={stage}>
        <section ref={documentSection} tabIndex={-1} className="portal-sign-document" aria-label="Revisá el documento">
          {stage === 0 && target && <div className="portal-sign-location">
            {fields.length > 1 ? <select aria-label="Elegí tu recuadro de firma" value={selectedFieldId} onChange={event => {
              const field = fields.find(item => item.id === event.target.value);
              if (field) { setSelectedFieldId(field.id); showField(field); }
            }}><option value="" disabled>Elegí tu recuadro</option>{fields.map((field, index) => <option key={field.id} value={field.id}>Recuadro {index + 1} · pág. {field.page}</option>)}</select>
              : <span>Tu firma va en la página {target.page}</span>}
            <button type="button" onClick={() => showField()}><LocateFixed size={15} aria-hidden="true" />{fields.length > 1 ? 'Ver recuadro' : 'Ver dónde firmo'}</button>
          </div>}
          {loadError ? <p className="portal-sign-error">{loadError}</p> : <PortalDocumentViewer url={url} fields={fields} selectedFieldId={selected?.id || ''} focusFieldRequest={focusFieldRequest}
            signatureImage={mode === 'drawn' ? image : ''} signatureName={stage === 2 && mode === 'typed' ? name : ''}
            onSelectField={id => { if (stage === 0 && !submitting.current) setSelectedFieldId(id); }} onPageCount={setPageCount} onReady={setReady} onLoadError={setViewerError} onRetry={onRetry} />}
        </section>

        <div className="portal-sign-details" hidden={stage === 0}>
          <fieldset disabled={busy || checkDocuments}>
            <section className="portal-sign-step" hidden={stage !== 1}>
              <h3 ref={stage === 1 ? heading : undefined} tabIndex={-1}>Confirmá tu DNI</h3>
              <p className="portal-sign-account">Firmás con <strong>{signer.email}</strong></p>
              <label className="portal-sign-label">DNI<input autoComplete="off" inputMode="numeric" value={dni} readOnly={Boolean(doc.requiredDni)} placeholder="Ingresá tu DNI" onChange={event => { setDni(event.target.value); setDniConfirmed(false); setError(''); }} /></label>
              <label className="portal-sign-check"><input type="checkbox" checked={dniConfirmed} disabled={!validDni} onChange={event => setDniConfirmed(event.target.checked)} /><span>Confirmo que este DNI me corresponde.</span></label>
            </section>

            <section className="portal-sign-step" hidden={stage !== 2}>
              <h3 ref={stage === 2 ? heading : undefined} tabIndex={-1}>Prepará tu firma</h3>
              <div className="portal-sign-modes" role="group" aria-label="Tipo de firma">
                <button type="button" aria-pressed={mode === 'typed'} onClick={() => { setMode('typed'); setError(''); }}>Usar mi nombre</button>
                <button type="button" aria-pressed={mode === 'drawn'} onClick={() => { setMode('drawn'); setError(''); }}>Dibujar firma</button>
              </div>
              <div hidden={mode !== 'drawn'}><PortalSignatureCanvas onChange={value => { setImage(value); setError(''); }} /></div>
              {mode === 'typed' && <><label className="portal-sign-label">Nombre para la firma<input autoComplete="name" value={name} onChange={event => { setName(event.target.value); setError(''); }} /></label>
                <div className="portal-sign-name-preview" aria-label="Vista previa de tu firma">{name.trim() || 'Tu nombre'}</div></>}
              <label className="portal-sign-check"><input type="checkbox" checked={accepted} onChange={event => { setAccepted(event.target.checked); setError(''); }} /><span>Leí el documento y acepto firmarlo electrónicamente con mi cuenta verificada y los datos declarados.</span></label>
            </section>
          </fieldset>
        </div>
      </div>

      <footer className="portal-sign-next">
        {(guidance || slow) && <div className="portal-sign-guidance" id="portal-sign-guidance">
          {guidance && <p role={error || documentError ? 'alert' : 'status'}>{guidance}</p>}
          {slow && <p className="portal-sign-muted">{busy ? 'Mantené esta ventana abierta para confirmar el resultado.' : preparing ? 'La preparación está tardando. Podés volver a intentarlo desde Documentos.' : 'La carga está tardando. Podés volver a cargar el PDF.'}</p>}
        </div>}
        <div className="portal-sign-navigation">
          {stage > 0 && !busy && !checkDocuments && <button type="button" onClick={() => { setError(''); setStage(stage - 1); }}><ArrowLeft size={16} aria-hidden="true" />Atrás</button>}
          <button type="button" className="portal-sign-primary" aria-describedby={guidance || slow ? 'portal-sign-guidance' : undefined} disabled={busy || !(complete || retry || canAdvance)} onClick={continueSigning}>
            {primaryLabel}{!complete && !retry && !busy && (stage === 2 ? <PenLine size={16} aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />)}
          </button>
        </div>
      </footer>
    </div>
  </div>;
}

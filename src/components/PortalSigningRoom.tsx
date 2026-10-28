import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeSigningDni, personalSignatureFields, type PortalSignatureInput } from "../lib/portalSigning";
import { PortalDocumentViewer } from "./PortalDocumentViewer";
import { PortalSignatureCanvas } from "./PortalSignatureCanvas";
import "./portalSigning.css";

type Props = {
  key?: string;
  document: { title: string; signatureFields?: unknown; requiredDni?: string };
  signer: { email: string; name: string };
  url: string;
  preparing?: boolean;
  loadError: string;
  onRetry: () => void;
  onClose: () => void;
  onSubmit: (input: PortalSignatureInput) => Promise<void>;
};

export function PortalSigningRoom({ document: doc, signer, url, loadError, onRetry, onClose, onSubmit, preparing = false }: Props) {
  const [dni, setDni] = useState(doc.requiredDni || "");
  const [name, setName] = useState(signer.name);
  const [dniConfirmed, setDniConfirmed] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"typed" | "drawn">("drawn");
  const [image, setImage] = useState("");
  const [selectedFieldId, setSelectedFieldId] = useState("");
  const [pageCount, setPageCount] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [focusFieldRequest, setFocusFieldRequest] = useState<{ id: string; revision: number }>();
  const dialog = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const ownFields = useMemo(() => personalSignatureFields(doc.signatureFields, signer.email), [doc.signatureFields, signer.email]);
  const fields = useMemo(() => ownFields.filter(f => f.page <= pageCount), [ownFields, pageCount]);
  const selected = fields.find(f => f.id === selectedFieldId);
  const target = selected || fields[0];
  const showField = () => { if (target) setFocusFieldRequest(current => ({ id: target.id, revision: (current?.revision || 0) + 1 })); };
  const cleanDni = normalizeSigningDni(dni);
  const validDni = /^\d{6,12}$/.test(cleanDni) && (!doc.requiredDni || cleanDni === doc.requiredDni);
  const canSign = !preparing && ready && !loadError && !!selected && validDni && dniConfirmed && accepted &&
    (mode === "drawn" ? !!image : !!name.trim());

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);

  async function submit() {
    if (!canSign || submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      await onSubmit({ fieldId: selected.id, dni: cleanDni, typedName: name.trim(), signatureType: mode, signatureImage: mode === "drawn" ? image : "" });
    } catch (e: any) {
      setError(e.message || "No pudimos registrar tu firma. Intentá nuevamente.");
    } finally { submitting.current = false; setBusy(false); }
  }

  return <div className="portal-sign-backdrop">
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="portal-sign-title" tabIndex={-1} className="portal-sign-dialog"
      onKeyDown={e => {
        if (e.key === "Escape" && !submitting.current) { e.stopPropagation(); onClose(); }
        if (e.key === "Tab") {
          const elements = (Array.from(dialog.current?.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]') || []) as HTMLElement[]).filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden");
          const first = elements[0], last = elements[elements.length - 1];
          if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus(); }
          else if (!e.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { e.preventDefault(); first?.focus(); }
        }
      }}>
      <header className="portal-sign-header"><div><p>Firma de documentos</p><h2 id="portal-sign-title">{doc.title}</h2></div><button type="button" disabled={busy} onClick={onClose}>Cerrar</button></header>
      <div className="portal-sign-layout">
        <div className="portal-sign-document">
          <h3>1. Revisá el documento</h3>
          {preparing && <p role="status" className="portal-sign-field-status">Preparando tu documento para revisar y firmar…</p>}
          {!!target && <div className={`portal-sign-location ${selected ? 'is-selected' : ''}`} role="status"><span>{selected ? `Recuadro seleccionado · página ${selected.page}` : `Tocá tu recuadro de firma en la página ${target.page}.`}</span><button type="button" onClick={showField}>Mostrar dónde firmar</button></div>}
          {loadError ? <div className="portal-sign-load-error"><p role="alert">{loadError}</p><button type="button" onClick={onRetry}>Volver a cargar</button></div> :
            <PortalDocumentViewer url={url} fields={fields} selectedFieldId={selectedFieldId} focusFieldRequest={focusFieldRequest} signatureImage={mode === "drawn" ? image : ""} signatureName={mode === "typed" ? name : ""} onSelectField={id => { if (!submitting.current) setSelectedFieldId(id); }} onPageCount={setPageCount} onReady={setReady} onRetry={onRetry} />}
        </div>
        <aside className="portal-sign-details" aria-label="Tus datos y firma">
          <fieldset disabled={busy}>
            <section className="portal-sign-card">
              <h3>2. Confirmá tus datos</h3>
              <p className="portal-sign-muted">Vas a firmar con esta cuenta de Google:</p><strong className="portal-sign-email">{signer.email}</strong>
              <label className="portal-sign-label">DNI<input autoComplete="off" inputMode="numeric" value={dni} readOnly={!!doc.requiredDni} placeholder="Ingresá tu DNI" onChange={e => { setDni(e.target.value); setDniConfirmed(false); }} /></label>
              <label className="portal-sign-check"><input type="checkbox" checked={dniConfirmed} disabled={!validDni || busy} onChange={e => setDniConfirmed(e.target.checked)} /><span>Confirmo que el DNI ingresado me corresponde.</span></label>
            </section>
            <section className="portal-sign-card">
              <h3>3. Prepará tu firma</h3>
              <div className="portal-sign-modes" role="group" aria-label="Tipo de firma">
                <button type="button" aria-pressed={mode === "drawn"} onClick={() => setMode("drawn")}>Dibujar firma</button>
                <button type="button" aria-pressed={mode === "typed"} onClick={() => setMode("typed")}>Usar mi nombre</button>
              </div>
              <div hidden={mode !== "drawn"}><p className="portal-sign-muted">Dibujá con el dedo, lápiz o mouse.</p><PortalSignatureCanvas onChange={setImage} /></div>
              {mode === "typed" && <><label className="portal-sign-label">Nombre para la firma<input autoComplete="name" value={name} onChange={e => setName(e.target.value)} /></label><div className="portal-sign-name-preview">{name || "Tu nombre"}</div></>}
              <p role="status" className={`portal-sign-field-status ${selected ? "is-ready" : ""}`}>{selected ? `✓ Recuadro seleccionado · página ${selected.page}` : "Seleccioná tu recuadro de firma sobre el documento."}</p>
              {!selected && target && <button type="button" className="portal-sign-locate" onClick={showField}>Ir al recuadro · página {target.page}</button>}
              {ready && !fields.length && <p role="alert" className="portal-sign-error">Este documento no tiene un recuadro válido asignado a tu cuenta. Pedí que revisen la solicitud de firma.</p>}
            </section>
            <section className="portal-sign-card">
              <h3>4. Firmá el documento</h3>
              <label className="portal-sign-check"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} /><span>Leí el documento y acepto firmarlo electrónicamente con mi cuenta verificada y los datos declarados.</span></label>
              {error && <p role="alert" className="portal-sign-error">{error}</p>}
              <button type="button" className="portal-sign-submit" disabled={busy || !canSign} onClick={submit}>{busy ? "Registrando firma…" : "Firmar y confirmar"}</button>
              {!canSign && !busy && <p role="status" className="portal-sign-muted">{!selected && fields.length ? 'Falta seleccionar el recuadro de firma. Usá «Ir al recuadro» y tocá el recuadro resaltado en el documento.' : 'Para continuar, revisá el PDF y completá las confirmaciones.'}</p>}
            </section>
          </fieldset>
        </aside>
      </div>
    </div>
  </div>;
}

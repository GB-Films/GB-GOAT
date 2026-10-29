import { useEffect, useRef, useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { PortalDocumentViewer } from '../../components/PortalDocumentViewer';
import { contractPreparationIssue, placeContractField, type ContractSigner } from '../../lib/contractPreparation';
import type { PortalSignatureField } from '../../lib/portalSigning';
import '../../components/portalSigning.css';

export function ProjectContractEditor({ title, url, providers, initialProviderId, initialSigners, initialFields = [], frozen = false, loadError = '', onRetry, onClose, onSubmit }: {
  title: string; url: string; providers: ContractSigner[]; initialProviderId?: string; loadError?: string;
  initialSigners?: ContractSigner[]; initialFields?: PortalSignatureField[]; frozen?: boolean;
  onRetry: () => void; onClose: () => void; onSubmit: (providerIds: string[], fields: PortalSignatureField[]) => Promise<void>;
}) {
  const initial = providers.find(provider => provider.providerId === initialProviderId && provider.email);
  const [signers, setSigners] = useState<ContractSigner[]>(initialSigners || (initial ? [initial] : []));
  const [active, setActive] = useState(initialSigners?.[0]?.email || initial?.email || '');
  const [choice, setChoice] = useState('');
  const [fields, setFields] = useState<PortalSignatureField[]>(initialFields);
  const [pages, setPages] = useState(0), [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const issue = contractPreparationIssue(signers, fields, pages);
  const field = fields.find(field => field.signerEmail === active);
  const signer = signers.find(signer => signer.email === active);
  const busyRef = useRef(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    const oldOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = oldOverflow; previous?.focus(); };
  }, []);
  function changeField(next: PortalSignatureField) { setFields(current => current.map(field => field.id === next.id ? next : field)); }
  return <dialog ref={dialog} aria-label="Preparar firma del contrato" className="portal-sign-dialog contract-preparation-dialog"
    onCancel={event => { event.preventDefault(); if (!busyRef.current) onClose(); }}>
    <header className="portal-sign-header"><div><p>Preparar firma · GB Sign</p><h2>{title}</h2></div>
      <button type="button" onClick={onClose} disabled={busy} aria-label="Cerrar preparación"><X size={18} /></button>
    </header>
    <div className="portal-sign-layout">
      <div className="portal-sign-document">{loadError ? <div className="portal-sign-error" role="alert">{loadError}<button type="button" onClick={onRetry}>Volver a cargar</button></div> : url ?
        <PortalDocumentViewer url={url} fields={fields} selectedFieldId={field?.id || ''} signatureImage="" signatureName=""
          onPageCount={setPages} onReady={setReady} onRetry={onRetry} onSelectField={id => { const selected = fields.find(field => field.id === id); if (selected) setActive(selected.signerEmail); }}
          editor={{ disabled: busy || !active || frozen, onPlace: (page, x, y) => { setFields(current => placeContractField(current, active, page, x, y)); setError(''); }, onChange: changeField }} />
        : <p role="status">Cargando PDF…</p>}</div>
      <aside className="portal-sign-details"><fieldset disabled={busy}>
        <h3>Proveedores que deben firmar</h3>
        {frozen && <p className="portal-sign-field-status">Recuperamos la preparación anterior. Podés reintentar la solicitud conservando el mismo PDF y los recuadros.</p>}
        <label className="portal-sign-label">Agregar proveedor<select disabled={frozen} value={choice} onChange={event => setChoice(event.target.value)}>
          <option value="">Elegí un proveedor</option>
          {providers.filter(provider => !signers.some(signer => signer.providerId === provider.providerId)).map(provider => <option key={provider.providerId} value={provider.providerId} disabled={!provider.email}>{provider.name} · {provider.email || 'Sin correo personal'}</option>)}
        </select></label>
        <button type="button" disabled={frozen || !choice || signers.length >= 10} onClick={() => {
          const selected = providers.find(provider => provider.providerId === choice);
          if (!selected?.email) return;
          if (signers.some(signer => signer.email === selected.email)) { setError('Dos proveedores comparten el correo. Elegí una sola ficha para esa cuenta.'); return; }
          setSigners(current => [...current, selected]); setActive(selected.email); setChoice(''); setError('');
        }}><Plus size={14} className="inline" /> Agregar firmante</button>
        {signers.map(person => <div key={person.providerId} className="portal-sign-card">
          <label className="portal-sign-check"><input type="radio" name="active-contract-signer" checked={active === person.email} onChange={() => setActive(person.email)} />
            <span><strong>{person.name}</strong><span className="block break-all text-xs">{person.email}</span></span></label>
          <div className="flex items-center justify-between gap-2"><small>{fields.find(field => field.signerEmail === person.email) ? `Recuadro en página ${fields.find(field => field.signerEmail === person.email)!.page}` : 'Falta ubicar su firma en el PDF'}</small>
            <button type="button" disabled={frozen} aria-label={`Quitar firmante ${person.name}`} onClick={() => {
              setSigners(current => current.filter(signer => signer.providerId !== person.providerId)); setFields(current => current.filter(field => field.signerEmail !== person.email));
              if (active === person.email) setActive(signers.find(signer => signer.email !== person.email)?.email || '');
            }}><Trash2 size={14} /></button></div>
        </div>)}
        {signer && <div className="portal-sign-card"><h3>Recuadro de {signer.name}</h3>
          {!frozen && <p className="portal-sign-muted">Tocá la hoja para colocar o mover su recuadro.</p>}
          {signer.dni && <p className="portal-sign-muted">DNI de la ficha: {signer.dni}</p>}
          {field && <>
            <label className="portal-sign-label">Página<input disabled={frozen} type="number" min="1" max={pages} value={field.page} onChange={event => changeField({ ...field, page: Number(event.target.value) })} /></label>
            <label className="portal-sign-label">Ancho del recuadro<input disabled={frozen} type="range" min="10" max="60" value={Math.round(field.w * 100)} onChange={event => { const w = Number(event.target.value) / 100; changeField({ ...field, w, x: Math.min(field.x, 1 - w) }); }} /></label>
            <label className="portal-sign-label">Alto del recuadro<input disabled={frozen} type="range" min="5" max="25" value={Math.round(field.h * 100)} onChange={event => { const h = Number(event.target.value) / 100; changeField({ ...field, h, y: Math.min(field.y, 1 - h) }); }} /></label>
          </>}
          <p className="portal-sign-muted">El proveedor confirmará su DNI y hará su firma desde su cuenta de Google. El recuadro incluirá firma, nombre, DNI y fecha.</p>
        </div>}
        {(error || issue) && <p role={error ? 'alert' : 'status'} className={error ? 'portal-sign-error' : 'portal-sign-field-status'}>{error || issue}</p>}
        <button type="button" className="portal-sign-submit" disabled={busy || !ready || Boolean(issue) || Boolean(loadError)} onClick={async () => {
          if (busyRef.current || issue || !ready) return;
          busyRef.current = true; setBusy(true); setError('');
          try { await onSubmit(signers.map(signer => signer.providerId), fields); }
          catch (error: any) { setError(error.message || 'No pudimos solicitar las firmas. Reintentá.'); }
          finally { busyRef.current = false; setBusy(false); }
        }}>{busy ? 'Solicitando firmas…' : 'Solicitar firmas'}</button>
        <p className="portal-sign-muted">Al confirmar, cada firmante encontrará este contrato en Mi proveedor → Documentos → Revisar y firmar, ingresando con el correo Google indicado arriba. La solicitud no envía un correo automáticamente.</p>
      </fieldset></aside>
    </div>
  </dialog>;
}

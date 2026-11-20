import { useId, useRef, useState } from 'react';
import { GoogleAuthProvider, reauthenticateWithPopup } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { downloadPortalFile, portalRequest } from '../lib/providerPortal';
import { verifyRegistrationSession } from '../lib/providerRegistrationFlow';
import { evidenceFileType, evidenceUploadFailure, uploadEvidenceBatch, verifyAndUploadEvidence, type PendingEvidence, type EvidenceFile, type EvidenceUploadProblem } from '../lib/providerEvidenceUpload';
export type { EvidenceFile } from '../lib/providerEvidenceUpload';

export function PrivateEvidenceField({ providerId, email, kind, label, help, values, maxFiles, onChange, onUploadingChange, sectionId, disabled = false, request = portalRequest }: {
  providerId: string; email: string; kind: string; label: string; help: string; values: EvidenceFile[]; maxFiles: number;
  onChange: (files: EvidenceFile[]) => void; onUploadingChange?: (busy: boolean) => void; sectionId: string; disabled?: boolean; request?: typeof portalRequest;
}) {
  const inputId = useId(), fileInput = useRef<HTMLInputElement>(null), locked = useRef(false);
  const queue = useRef<PendingEvidence[]>([]), expected = useRef({ uid: '', email });
  const [pending, setPending] = useState<PendingEvidence[]>([]), [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<EvidenceUploadProblem | null>(null);

  function finish() {
    locked.current = false; setBusy(false);
    // A pending second side must not be silently omitted from the declaration.
    onUploadingChange?.(queue.current.length > 0);
    if (!queue.current.length && fileInput.current) fileInput.current.value = '';
  }
  function clearSelection() {
    queue.current = []; setPending([]); setProblem(null); onUploadingChange?.(false);
    if (fileInput.current) fileInput.current.value = '';
  }
  function batch() {
    const uploaded = [...values];
    return uploadEvidenceBatch(providerId, kind, [...queue.current], {
      verifySession: () => verifyRegistrationSession(() => auth.currentUser, expected.current), request,
      read: file => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = reader.onabort = () => reject(Error('No pudimos leer el archivo. Volvé a elegirlo.'));
        reader.readAsDataURL(file);
      }),
      onUploaded: (item, result) => {
        if (!uploaded.some(file => file.id === result.id)) uploaded.push(result);
        onChange([...uploaded]);
        queue.current = queue.current.filter(file => file.attemptId !== item.attemptId);
        setPending([...queue.current]);
      },
    });
  }
  function upload() {
    if (disabled || locked.current || !queue.current.length) return;
    locked.current = true; setBusy(true); setProblem(null); onUploadingChange?.(true);
    void batch().catch(error => setProblem(evidenceUploadFailure(error))).finally(finish);
  }
  function verify() {
    if (disabled || locked.current || !queue.current.length) return;
    const user = auth.currentUser;
    if (!user || user.uid !== expected.current.uid) {
      setProblem({ message: 'Cambió tu sesión. Volvé a ingresar con el correo de esta ficha y elegí el archivo nuevamente.' }); return;
    }
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account', login_hint: expected.current.email });
    locked.current = true; setBusy(true); setProblem(null); onUploadingChange?.(true);
    // No await before opening Google: this call runs in the button's click.
    try { void verifyAndUploadEvidence(() => reauthenticateWithPopup(user, provider), batch)
      .catch(error => setProblem(evidenceUploadFailure(error))).finally(finish); }
    catch (error) { setProblem(evidenceUploadFailure(error)); finish(); }
  }

  const canSelect = !disabled && !busy && !pending.length && values.length < maxFiles;
  return <div id={sectionId} tabIndex={-1} className="scroll-mt-4 space-y-2 rounded-xl border border-slate-200 p-3">
    <p id={inputId + '-label'} className="text-sm font-medium">{label}</p>
    <p id={inputId + '-help'} className="text-xs text-slate-600">{help}</p>
    <input ref={fileInput} id={inputId} name={kind} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/jpeg,image/png,image/heic,image/heif"
      aria-labelledby={inputId + '-label'} aria-describedby={inputId + '-help' + (problem ? ' ' + inputId + '-error' : '')} aria-invalid={Boolean(problem)}
      disabled={!canSelect} className="peer sr-only" onChange={event => {
        const files = Array.from(event.currentTarget.files || []); if (!files.length || locked.current) return;
        setProblem(null);
        try {
          if (values.length + files.length > maxFiles) throw Error('Seleccionaste ' + files.length + ' archivos y te quedan ' + (maxFiles - values.length) + ' lugares. Elegí solo los que faltan o quitá uno de los adjuntos.');
          files.forEach(evidenceFileType);
          expected.current = { uid: auth.currentUser?.uid || '', email };
          queue.current = files.map(file => ({ file, attemptId: crypto.randomUUID() }));
          setPending([...queue.current]); upload();
        } catch (error) { setProblem({ message: (error as Error).message }); event.currentTarget.value = ''; }
      }} />
    {canSelect && <label htmlFor={inputId} className="portal-button inline-flex cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-blue-600">
      {values.length ? 'Adjuntar otro archivo' : kind === 'identity_document' ? 'Adjuntar DNI' : 'Adjuntar respaldo'}
    </label>}
    {pending.length > 0 && <div className="space-y-1 text-xs text-slate-600">
      {pending.map(item => <p key={item.attemptId} className="break-all">{item.file.name} · {busy ? 'cargando' : 'pendiente de carga'}</p>)}
      {!busy && <button type="button" disabled={disabled} className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100" onClick={clearSelection}>Quitar selección</button>}
    </div>}
    {values.map(file => <div key={file.id} className="flex min-w-0 items-center gap-2 text-xs"><button type="button" className="min-w-0 flex-1 break-all text-left text-blue-700 hover:underline" onClick={async () => {
      try { downloadPortalFile(await request({ action: 'evidenceFile', providerId, evidenceId: file.id })); }
      catch { setProblem({ message: 'No pudimos abrir el respaldo. Intentá nuevamente.' }); }
    }}>{file.fileName}</button><span className="shrink-0 text-emerald-700">Cargado</span><button type="button" disabled={disabled || busy || !!pending.length} aria-label={'Quitar ' + file.fileName + ' de esta presentación'} className="shrink-0 rounded px-2 py-1 text-slate-500 hover:bg-slate-100" onClick={() => onChange(values.filter(value => value.id !== file.id))}>Quitar</button></div>)}
    {busy && <p role="status" className="text-xs text-slate-600">Preparando y cargando el archivo…</p>}
    {problem && <div id={inputId + '-error'} role="alert" className="space-y-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-950"><p className="break-words">{problem.message}</p>
      {problem.reference && <p className="break-all">Si vuelve a fallar, compartí esta referencia con Gran Berta · {problem.reference}</p>}
      {problem.verify && !!pending.length && <button type="button" disabled={disabled || busy} className="portal-button" onClick={verify}>Verificar con Google y cargar</button>}
      {problem.retry && !!pending.length && <button type="button" disabled={disabled || busy} className="portal-button" onClick={upload}>Reintentar carga</button>}
    </div>}
  </div>;
}

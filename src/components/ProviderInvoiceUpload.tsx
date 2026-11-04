import { useRef, useState } from 'react';
import { GoogleAuthProvider, reauthenticateWithPopup } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { portalRequest } from '../lib/providerPortal';
import { verifyRegistrationSession } from '../lib/providerRegistrationFlow';
import { invoiceFileType, invoiceWorkUnavailable, portalInvoiceFailure, submitPortalInvoice, type InvoiceWork } from '../lib/portalInvoiceUpload';

export function ProviderInvoiceUpload({ providerId, works, onUploaded }: { providerId: string; works: InvoiceWork[]; onUploaded: () => Promise<unknown> }) {
  const [workKey, setWorkKey] = useState(''), [file, setFile] = useState<File | null>(null), [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ReturnType<typeof portalInvoiceFailure> | null>(null), [notice, setNotice] = useState('');
  const attempt = useRef(''), fileInput = useRef<HTMLInputElement>(null), locked = useRef(false);
  const work = works.find(w => w.key === workKey), unavailable = invoiceWorkUnavailable(work);
  const expected = () => ({ uid: auth.currentUser?.uid || '', email: auth.currentUser?.email || '' });
  function verify() {
    if (locked.current) return;
    const user = auth.currentUser;
    if (!user) { setProblem({ message: 'Ingresá con tu cuenta Google de proveedor.' }); return; }
    const account = expected(), provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account', login_hint: account.email });
    locked.current = true; setBusy(true); setProblem(null); setNotice('');
    // Open Google directly from the click, before any token or file await.
    void reauthenticateWithPopup(user, provider).then(async () => {
      await verifyRegistrationSession(() => auth.currentUser, account);
      setNotice('Cuenta verificada. Tocá «Cargar factura» para continuar.');
    }).catch(error => setProblem(portalInvoiceFailure(error))).finally(() => { locked.current = false; setBusy(false); });
  }
  async function upload() {
    if (locked.current || !work || !file || unavailable) return;
    locked.current = true; setBusy(true); setProblem(null); setNotice('');
    const account = expected();
    try {
      await submitPortalInvoice({ providerId, work, file, attemptId: attempt.current }, {
        verifySession: () => verifyRegistrationSession(() => auth.currentUser, account), request: portalRequest,
        read: file => new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = reader.onabort = () => reject(Error('No pudimos leer el archivo. Volvé a elegirlo.'));
          reader.readAsDataURL(file);
        }),
      });
      setNotice('Factura cargada. Ya está disponible en el proyecto.'); setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      await onUploaded();
    } catch (error) { setProblem(portalInvoiceFailure(error)); }
    finally { locked.current = false; setBusy(false); }
  }
  return <div className="portal-panel space-y-3">
    <h3 className="font-semibold">Cargar factura</h3>
    <p className="text-sm text-slate-500">Elegí el proyecto y trabajo. Podés adjuntar una factura si todavía no tiene una.</p>
    {!works.length && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Todavía no tenés trabajos asignados. Pedí a producción que vincule el gasto a tu ficha.</p>}
    <label className="block text-sm font-medium">Proyecto y trabajo
      <select className="mt-1 w-full rounded-lg border p-2" value={workKey} disabled={busy} onChange={e => { setWorkKey(e.target.value); setProblem(null); setNotice(''); attempt.current = crypto.randomUUID(); }}>
        <option value="">Elegí un trabajo</option>
        {works.map(w => <option key={w.key} value={w.key}>{w.projectName} · {w.description}{w.hasInvoice || w.invoiceCount > 0 ? ' · Factura cargada' : w.thirdPartyPayoutRequired ? ' · Factura de tercero' : ''}</option>)}
      </select>
    </label>
    {work && unavailable && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{unavailable}</p>}
    <label className="block text-sm font-medium">Archivo de la factura
      <input ref={fileInput} className="mt-1 block w-full rounded-lg border p-2 text-sm" type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" disabled={busy || !!unavailable}
        onChange={e => { setProblem(null); setNotice(''); const next = e.target.files?.[0]; setFile(null); if (!next) return;
          try { invoiceFileType(next); setFile(next); attempt.current = crypto.randomUUID(); }
          catch (error) { e.target.value = ''; setProblem(portalInvoiceFailure(error)); } }} />
    </label>
    <p className="text-xs text-slate-500">PDF, JPG o PNG · hasta 2 MB. Podés eliminar y volver a cargar tus propias facturas. Las de producción sólo se consultan.</p>
    {problem && <div role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><p>{problem.message}</p>
      {problem.verify && <button type="button" className="portal-button mt-2" disabled={busy} onClick={verify}>Verificar con Google</button>}
      {problem.refresh && <button type="button" className="portal-button mt-2" disabled={busy} onClick={() => void onUploaded()}>Actualizar facturas</button>}
    </div>}
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
    <button type="button" className="portal-button portal-button-primary" disabled={busy || !file || !!unavailable} onClick={() => void upload()}>{busy ? 'Procesando…' : 'Cargar factura'}</button>
  </div>;
}

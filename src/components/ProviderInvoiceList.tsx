import { useRef, useState } from 'react';
import { GoogleAuthProvider, reauthenticateWithPopup } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { portalRequest } from '../lib/providerPortal';
import { verifyRegistrationSession } from '../lib/providerRegistrationFlow';
import { portalInvoiceFailure } from '../lib/portalInvoiceUpload';

export type PortalInvoice = { index: number; fileName?: string; canRemove: boolean; uploadId?: string; revision?: number };
export function ProviderInvoiceList({ providerId, work, busy, onDownload, onChanged }: {
  providerId: string; work: { key: string; projectName: string; description: string; invoiceCount: number; invoices?: PortalInvoice[] };
  busy: boolean; onDownload: (index: number) => void; onChanged: () => Promise<unknown>;
}) {
  const [selected, setSelected] = useState<PortalInvoice | null>(null), [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<{ message: string; verify?: boolean } | null>(null), [notice, setNotice] = useState('');
  const attempt = useRef(''), locked = useRef(false);
  const files = work.invoices || Array.from({ length: work.invoiceCount }, (_, index) => ({ index, canRemove: false } as PortalInvoice));
  function failure(error: any) {
    const issue = portalInvoiceFailure(error);
    if (issue.verify) return { message: 'Verificá tu cuenta con Google y después volvé a confirmar la eliminación.', verify: true };
    if (/network|unavailable|deadline-exceeded|aborted/.test(error?.code || '')) return { message: 'No pudimos confirmar la eliminación. Reintentá con este mismo botón o actualizá Facturas.' };
    return issue;
  }
  function verify() {
    const user = auth.currentUser;
    if (!user || locked.current) return;
    const expected = { uid: user.uid, email: user.email || '' }, provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account', login_hint: expected.email });
    locked.current = true; setWorking(true); setProblem(null);
    void reauthenticateWithPopup(user, provider).then(() => verifyRegistrationSession(() => auth.currentUser, expected))
      .then(() => setNotice('Cuenta verificada. Confirmá la eliminación.')).catch(error => setProblem(failure(error)))
      .finally(() => { locked.current = false; setWorking(false); });
  }
  async function remove() {
    if (!selected?.canRemove || locked.current) return;
    locked.current = true; setWorking(true); setProblem(null); setNotice('');
    try {
      const expected = { uid: auth.currentUser?.uid || '', email: auth.currentUser?.email || '' };
      await verifyRegistrationSession(() => auth.currentUser, expected);
      const result = await portalRequest({ action: 'removeInvoice', providerId, workKey: work.key,
        uploadId: selected.uploadId, revision: selected.revision, attemptId: attempt.current });
      if (!result?.removed) throw Error('No recibimos la confirmación. Actualizá Facturas antes de continuar.');
      setSelected(null); setNotice('Factura eliminada. Ya podés cargar la correcta.');
      await onChanged();
    } catch (error) { setProblem(failure(error)); }
    finally { locked.current = false; setWorking(false); }
  }
  return <article className="portal-panel space-y-2">
    <h3 className="font-semibold">{work.projectName}</h3><p className="text-sm text-slate-500">{work.description}</p>
    {files.map(file => <div key={file.index} className="flex min-w-0 flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
      <button type="button" className="portal-button min-w-0 max-w-full" disabled={busy || working} onClick={() => onDownload(file.index)}><span className="truncate">{file.fileName || `Factura ${file.index + 1}`}</span></button>
      {file.canRemove && <button type="button" className="portal-button text-red-700" disabled={busy || working} onClick={() => {
        setSelected(file); setProblem(null); setNotice(''); attempt.current = crypto.randomUUID();
      }}>Eliminar mi factura</button>}
    </div>)}
    {selected && <div className="space-y-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="group" aria-label="Confirmar eliminación de factura">
      <p>¿Eliminar esta factura? Después podés cargar la correcta.</p>
      <div className="flex flex-wrap gap-2"><button type="button" className="portal-button" disabled={busy || working} onClick={() => void remove()}>{working ? 'Procesando…' : 'Sí, eliminar'}</button>
        <button type="button" className="portal-button" disabled={working} onClick={() => { setSelected(null); setProblem(null); }}>Cancelar</button></div>
    </div>}
    {problem && <div role="alert" className="text-sm text-amber-900"><p>{problem.message}</p>{problem.verify && <button type="button" className="portal-button mt-2" disabled={working} onClick={verify}>Verificar con Google</button>}</div>}
    {notice && <p role="status" className="text-sm text-emerald-800">{notice}</p>}
  </article>;
}

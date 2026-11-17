import { useState } from 'react';
import { openProviderFile, providerFinanceRequest } from '../lib/providerFinance';
import { portalErrorMessage } from '../lib/providerPortalUi';

export function ReportedPaymentDetails({ payment, projectId, itemId }: { key?: string; payment: any; projectId: string; itemId: string }) {
  const [details, setDetails] = useState<any>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (!payment.reportedPaymentId || payment.reportedPartIndex !== 0) return null;
  const scope = { projectId, collectionName: 'areaExpenses', itemId };
  async function load() {
    setBusy(true); setError('');
    try { setDetails(await providerFinanceRequest({ action: 'reportedPaymentState', id: payment.reportedPaymentId, ...scope })); }
    catch (e) { setError(portalErrorMessage(e as any)); }
    finally { setBusy(false); }
  }
  return <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950">
    <p className="font-semibold">Pago ya realizado</p>
    <p>{details?.documentaryStatus === 'accepted' ? 'Aceptación del proveedor registrada.' : 'Aceptación documental pendiente.'}</p>
    <button type="button" disabled={busy} onClick={() => void load()} className="mt-1 rounded border border-amber-300 px-2 py-1 hover:bg-amber-100 disabled:opacity-50">{busy ? 'Consultando…' : 'Ver estado y comprobantes'}</button>
    {error && <p role="alert" className="mt-1 text-rose-700">{error}</p>}
    {details?.proofs?.map((p: any) => <button key={p.index} type="button" disabled={busy} className="mt-2 block text-left underline hover:text-amber-700" onClick={async () => {
      setBusy(true); setError(''); try { await openProviderFile(payment.reportedPaymentId, scope, p.index); }
      catch (e) { setError(portalErrorMessage(e as any)); } finally { setBusy(false); }
    }}>{p.sourceLabel} · ARS {(p.amountCents / 100).toLocaleString('es-AR', { minimumFractionDigits: 2 })} · {p.fileName}</button>)}
  </div>;
}

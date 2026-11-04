import { useEffect, useRef, useState } from 'react';
import { portalRequest } from '../lib/providerPortal';
import { portalErrorMessage } from '../lib/providerPortalUi';

export type PortalAdvance = { key: string; workKey: string; projectName: string; description: string; currency: string;
  paymentIndex: number; paymentVersion: string; date: string; amount: number; reimbursed: number; balance: number; hasReceipt: boolean;
  reimbursements: { id: string; index: number; amount: number; date: string; detail: string; hasReceipt: boolean }[] };
const money = (n: number, currency: string) => new Intl.NumberFormat('es-AR', { style: 'currency', currency }).format(n);
const date = (value: string) => value?.slice(0, 10).split('-').reverse().join('/') || 'Sin fecha';
export function ProviderAdvanceCards({ advances, busy, onDownload }: { advances: PortalAdvance[]; busy: boolean; onDownload: (input: any) => void }) {
  return <div className="space-y-2">{advances.map(a => <article key={a.key} className="portal-panel space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{a.projectName}</h3><span className={`portal-status ${a.balance > 0 ? 'portal-status-pending' : 'portal-status-signed'}`}>{a.balance > 0 ? 'Reintegro pendiente' : 'Reintegrado'}</span></div>
    <p className="text-sm text-slate-600">{a.description}</p>
    <dl className="portal-money-grid grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-2 text-xs">
      <div><dt className="text-slate-500">Adelantaste</dt><dd className="font-semibold">{money(a.amount, a.currency)}</dd></div>
      <div><dt className="text-slate-500">Te devolvieron</dt><dd className="font-semibold">{money(a.reimbursed, a.currency)}</dd></div>
      <div><dt className="text-slate-500">Falta devolver</dt><dd className="font-semibold">{money(a.balance, a.currency)}</dd></div>
    </dl>
    <p className="text-xs text-slate-500">Adelanto del {date(a.date)}</p>
    {a.hasReceipt && <button type="button" className="portal-button" disabled={busy} onClick={() => onDownload({ workKey: a.workKey, kind: 'advance', paymentIndex: a.paymentIndex, paymentVersion: a.paymentVersion, index: 0 })}>Comprobante del adelanto</button>}
    {!!a.reimbursements.length && <details className="portal-details"><summary>Devoluciones recibidas · {a.reimbursements.length}</summary><div className="mt-2 space-y-2">
      {a.reimbursements.map(r => <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-sm"><span>{date(r.date)} · <strong>{money(r.amount, a.currency)}</strong>{r.detail && <span className="block text-xs text-slate-500">{r.detail}</span>}</span>
        {r.hasReceipt && <button type="button" className="portal-button" disabled={busy} onClick={() => onDownload({ workKey: a.workKey, kind: 'reimbursement', paymentIndex: a.paymentIndex, paymentVersion: a.paymentVersion, index: r.index })}>Comprobante</button>}
      </div>)}
    </div></details>}
  </article>)}</div>;
}
export function ProviderReimbursements({ providerId, busy, onDownload }: { providerId: string; busy: boolean; onDownload: (input: any) => void }) {
  const [rows, setRows] = useState<PortalAdvance[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const revision = useRef(0);
  async function load() {
    const run = ++revision.current; setLoading(true); setError('');
    try { const result = await portalRequest({ action: 'reimbursements', providerId });
      if (!Array.isArray(result.advances)) throw Error('No recibimos el historial de reintegros. Volvé a actualizar.');
      if (run === revision.current) setRows(result.advances);
    } catch (error) { if (run === revision.current) setError(portalErrorMessage(error)); }
    finally { if (run === revision.current) setLoading(false); }
  }
  useEffect(() => { void load(); return () => { revision.current++; }; }, [providerId]);
  return <section className="space-y-2" aria-label="Adelantos y reintegros">
    <div className="flex items-center justify-between gap-2"><div><h2 className="font-semibold">Adelantos y reintegros</h2><p className="text-xs text-slate-500">Gastos que pagaste de tu bolsillo.</p></div><button type="button" className="portal-button" disabled={loading || busy} onClick={() => void load()}>Actualizar</button></div>
    {loading ? <p role="status" className="portal-panel text-sm">Buscando tus reintegros…</p> : error ? <p role="alert" className="portal-panel text-sm text-amber-900">{error}</p> : rows.length ? <ProviderAdvanceCards advances={rows} busy={busy} onDownload={onDownload} /> : <p className="portal-panel text-sm text-slate-500">No hay adelantos registrados a tu nombre.</p>}
  </section>;
}

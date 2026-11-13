import { useEffect, useRef, useState } from 'react';
import { FileSignature } from 'lucide-react';
import { portalAdminRequest, downloadPortalFile } from '../lib/providerPortal';
import { portalErrorMessage } from '../lib/providerPortalUi';
import { canHaveCashReceipt, cashReceiptStatus } from '../lib/cashPaymentReceipts';
import { ProjectDialog } from '../pages/project-detail/ProjectDialog';

const money = (cents: number) => (cents / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function CashPaymentReceiptButton({ projectId, collectionName, itemId, payment, canRequest }: {
  key?: string; projectId: string; collectionName: string; itemId: string; payment: any; canRequest: boolean;
}) {
  const [open, setOpen] = useState(false), [source, setSource] = useState<any>(null), [rows, setRows] = useState<any[]>([]);
  const [allowed, setAllowed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [mode, setMode] = useState('ARS'), [ars, setArs] = useState(''), [usd, setUsd] = useState(''), [rate, setRate] = useState(''), [confirmed, setConfirmed] = useState(false);
  const attempt = useRef(''), scope = { projectId, collectionName, itemId, paymentId: payment?.id || '' };
  const scopeKey = JSON.stringify(scope), revision = useRef(0);
  const active = rows.find(r => !['cancelled', 'replaced'].includes(r.status));
  async function load() {
    const current = ++revision.current; setBusy(true); setError('');
    try {
      const result = await portalAdminRequest({ action: 'cashReceiptSource', ...scope });
      if (current !== revision.current) return;
      setSource(result.source); setRows(result.receipts.sort((a: any, b: any) => b.content.preparedAt.localeCompare(a.content.preparedAt))); setAllowed(result.canRequest);
      const pending = result.receipts.find((r: any) => r.status === 'preparing');
      if (pending) { const parts = pending.content.parts; setMode(parts.usdCents ? parts.arsCents ? 'mixed' : 'USD' : 'ARS'); setArs(String(parts.arsCents / 100)); setUsd(String(parts.usdCents / 100)); setRate(String(parts.rate || '')); }
      else { setMode('ARS'); setArs(String(result.source.amountCents / 100)); setUsd(''); setRate(''); }
    } catch (e) { if (current === revision.current) setError(portalErrorMessage(e as any)); }
    finally { if (current === revision.current) setBusy(false); }
  }
  useEffect(() => { if (open) { attempt.current = crypto.randomUUID(); setNotice(''); setConfirmed(false); void load(); } return () => { revision.current++; }; }, [open, scopeKey]);
  async function action(work: () => Promise<unknown>) { setBusy(true); setError(''); try { await work(); } catch (e) { setError(portalErrorMessage(e as any)); } finally { setBusy(false); } }
  if (!canHaveCashReceipt(payment)) return null;
  return <>
    <button type="button" onClick={() => setOpen(true)} className="ml-2 mt-2 inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[9px] font-semibold text-amber-900 transition-colors hover:border-amber-500 hover:bg-amber-100" title="Solicitar o ver el recibo firmado de este pago en efectivo"><FileSignature className="h-3 w-3" />Recibo</button>
    {open && <ProjectDialog title="Recibo del pago en efectivo" onClose={() => setOpen(false)}>
      <div className="space-y-4 text-sm">
        {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-800">{error}</p>}
        {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-800">{notice}</p>}
        {!source && busy && <p role="status">Consultando el pago…</p>}
        {source && <>
          <dl className="space-y-1 rounded-xl bg-slate-50 p-3"><div><dt className="inline text-slate-500">Proyecto: </dt><dd className="inline font-semibold">{source.projectName}</dd></div>
            <div><dt className="inline text-slate-500">Proveedor: </dt><dd className="inline">{source.providerName}</dd></div><div><dt className="inline text-slate-500">Fecha: </dt><dd className="inline">{source.date.split('-').reverse().join('/')}</dd></div>
            <div><dt className="inline text-slate-500">Concepto: </dt><dd className="inline">{source.concept || 'Sin detalle'}</dd></div><div><dt className="inline text-slate-500">Pago registrado: </dt><dd className="inline font-semibold">ARS {money(source.amountCents)} · {source.cashBoxLabel}</dd></div></dl>
          {canRequest && allowed && (!active || active.status === 'preparing') && <form className="space-y-3" onSubmit={event => { event.preventDefault(); void action(async () => {
            const receipt = await portalAdminRequest({ action: 'requestCashReceipt', ...scope, expectedFingerprint: source.fingerprint, attemptId: attempt.current,
              parts: { ars: mode === 'USD' ? 0 : Number(ars), usd: mode === 'ARS' ? 0 : Number(usd), rate: mode === 'ARS' ? 0 : Number(rate) } });
            if (!['requested', 'signed'].includes(receipt.status)) throw Error('El pago o la solicitud cambió. Actualizá el historial.');
            setNotice('Solicitud enviada a Mi proveedor → Documentos → Recibos. El proveedor verá un aviso para firmar.'); await load();
          }); }}>
            <label className="block font-medium">Efectivo que recibió<select value={mode} disabled={busy} onChange={event => { setMode(event.target.value); setConfirmed(false); }} className="mt-1 w-full rounded-lg border p-2 text-base"><option value="ARS">Pesos argentinos</option><option value="USD">Dólares estadounidenses</option><option value="mixed">Pesos y dólares</option></select></label>
            <div className="grid gap-3 sm:grid-cols-2">{mode !== 'USD' && <label className="block">Pesos (ARS)<input required type="number" min="0" step="0.01" value={ars} disabled={busy} onChange={e => setArs(e.target.value)} className="mt-1 w-full rounded-lg border p-2 text-base" /></label>}
              {mode !== 'ARS' && <><label className="block">Dólares (USD)<input required type="number" min="0.01" step="0.01" value={usd} disabled={busy} onChange={e => setUsd(e.target.value)} className="mt-1 w-full rounded-lg border p-2 text-base" /></label><label className="block sm:col-span-2">Cotización usada (pesos por dólar)<input required type="number" min="0.000001" step="0.000001" value={rate} disabled={busy} onChange={e => setRate(e.target.value)} className="mt-1 w-full rounded-lg border p-2 text-base" /></label></>}
            </div>
            <p className="text-xs text-slate-500">El desglose debe coincidir con los ARS {money(source.amountCents)} del pago. Se conserva el pago y su salida de caja.</p>
            <p className="text-xs">Firma con su cuenta registrada: <strong>{source.signerEmail || 'El proveedor debe completar su alta.'}</strong></p>
            <label className="flex gap-2 text-sm"><input type="checkbox" required checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />Confirmo el efectivo entregado y solicito la constancia de recepción.</label>
            <button disabled={busy || !confirmed || !source.signerEmail} className="portal-button portal-button-primary w-full">{busy ? 'Preparando…' : active ? 'Completar solicitud' : 'Solicitar firma de recibo'}</button>
          </form>}
          {rows.map(receipt => <article key={receipt.id} className="space-y-2 rounded-xl border border-slate-200 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{receipt.title}</h3><span className={`portal-status ${receipt.status === 'requested' ? 'portal-status-pending' : receipt.status === 'signed' ? 'portal-status-signed' : ''}`}>{cashReceiptStatus(receipt.status)}</span></div>
            <div className="flex flex-wrap gap-2">{receipt.signing && ['original', ...(receipt.signed ? ['signed', 'certificate'] : [])].map(artifact => <button key={artifact} type="button" disabled={busy} className="portal-button" onClick={() => void action(async () => downloadPortalFile(await portalAdminRequest({ action: 'cashReceiptFile', receiptId: receipt.id, artifact })))}>{({ original: 'Ver recibo', signed: 'PDF firmado', certificate: 'Certificado de firma' } as any)[artifact]}</button>)}
              {canRequest && allowed && receipt.status !== 'cancelled' && <button type="button" disabled={busy} className="portal-button text-rose-700" onClick={() => { const reason = window.prompt('Motivo de anulación. Se conserva el documento como antecedente.'); if (reason?.trim()) void action(async () => { await portalAdminRequest({ action: 'cancelCashReceipt', receiptId: receipt.id, reason: reason.trim() }); attempt.current = crypto.randomUUID(); await load(); }); }}>Anular recibo</button>}
            </div></article>)}
          {!allowed && !rows.length && <p className="text-slate-500">Todavía no hay un recibo para este pago.</p>}
        </>}
        <button type="button" className="portal-button" disabled={busy} onClick={() => void load()}>Actualizar</button>
      </div>
    </ProjectDialog>}
  </>;
}

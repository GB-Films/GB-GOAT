import { useEffect, useRef, useState } from 'react';
import { BadgeCheck, CheckCircle2, Clock3, Download, FileSignature, FileText, RefreshCw, XCircle } from 'lucide-react';
import { portalAdminRequest, downloadPortalFile } from '../lib/providerPortal';
import { portalErrorMessage } from '../lib/providerPortalUi';
import { canHaveCashReceipt, cashReceiptStatus } from '../lib/cashPaymentReceipts';
import { ProjectDialog } from '../pages/project-detail/ProjectDialog';

const money = (cents: number) => (cents / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateLabel = (value: string) => value.split('-').reverse().join('/');
const button = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold leading-tight transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50';
const secondary = `${button} border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-100`;
const primary = `${button} border-blue-700 bg-blue-700 text-white hover:bg-blue-800`;
const destroy = `${button} border-rose-200 bg-white text-rose-700 hover:border-rose-300 hover:bg-rose-50`;
const control = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50';
const files = {
  original: { title: 'Descargar original', Icon: FileText },
  signed: { title: 'Descargar PDF firmado', Icon: Download },
  certificate: { title: 'Descargar certificado', Icon: BadgeCheck },
} as const;
type ReceiptFile = keyof typeof files;
type ReceiptSource = { fingerprint: string; amountCents: number; date: string; concept: string; projectName: string; providerName: string; signerEmail: string; cashBoxLabel: string };
type Receipt = { id: string; status: string; signed: boolean; title: string; signing: unknown; content: { preparedAt: string; parts: { arsCents: number; usdCents: number; rate?: number } } };

export function CashPaymentReceiptButton({ projectId, collectionName, itemId, payment, canRequest }: {
  key?: string; projectId: string; collectionName: string; itemId: string; payment: any; canRequest: boolean;
}) {
  const [open, setOpen] = useState(false), [source, setSource] = useState<ReceiptSource | null>(null), [rows, setRows] = useState<Receipt[]>([]);
  const [allowed, setAllowed] = useState(false), [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [mode, setMode] = useState('ARS'), [ars, setArs] = useState(''), [usd, setUsd] = useState(''), [rate, setRate] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [cancelling, setCancelling] = useState(''), [reason, setReason] = useState('');
  const attempt = useRef(''), scope = { projectId, collectionName, itemId, paymentId: payment?.id || '' };
  const scopeKey = JSON.stringify(scope), revision = useRef(0);
  const active = rows.find(row => !['cancelled', 'replaced'].includes(row.status));
  const canManage = canRequest && allowed;

  async function load() {
    const current = ++revision.current;
    setBusy('load'); setError('');
    try {
      const result = await portalAdminRequest({ action: 'cashReceiptSource', ...scope }) as { source: ReceiptSource; receipts: Receipt[]; canRequest: boolean };
      if (current !== revision.current) return;
      setSource(result.source);
      setRows([...result.receipts].sort((a, b) => b.content.preparedAt.localeCompare(a.content.preparedAt)));
      setAllowed(result.canRequest);
      const parts = result.receipts.find(row => row.status === 'preparing')?.content.parts;
      setMode(parts?.usdCents ? parts.arsCents ? 'mixed' : 'USD' : 'ARS');
      setArs(String((parts?.arsCents ?? result.source.amountCents) / 100));
      setUsd(parts?.usdCents ? String(parts.usdCents / 100) : '');
      setRate(String(parts?.rate || ''));
      setConfirmed(false);
    } catch (err) {
      if (current === revision.current) setError(portalErrorMessage(err as { message?: string; code?: string }));
    } finally {
      if (current === revision.current) setBusy('');
    }
  }

  useEffect(() => {
    if (open) {
      attempt.current = crypto.randomUUID();
      setSource(null); setRows([]); setAllowed(false); setNotice(''); setConfirmed(false); setCancelling(''); setReason('');
      void load();
    }
    return () => { revision.current++; };
  }, [open, scopeKey]);

  async function action(key: string, work: (isCurrent: () => boolean) => Promise<void>) {
    if (busy) return;
    const current = revision.current;
    setBusy(key); setError(''); setNotice('');
    try { await work(() => current === revision.current); }
    catch (err) { if (current === revision.current) setError(portalErrorMessage(err as { message?: string; code?: string })); }
    finally { if (current === revision.current) setBusy(''); }
  }

  if (!canHaveCashReceipt(payment)) return null;
  return <>
    <button type="button" onClick={() => setOpen(true)} className="mt-2 inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-900 transition-colors hover:border-amber-400 hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"><FileSignature className="h-3.5 w-3.5" aria-hidden="true" />{canRequest ? 'Gestionar recibo' : 'Ver recibo'}</button>
    {open && <ProjectDialog title="Recibo del pago en efectivo" onClose={() => setOpen(false)}>
      <div className="space-y-4 text-sm text-slate-900">
        {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-900">{error}</p>}
        {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">{notice}</p>}
        {!source && busy && <p role="status" className="rounded-lg bg-slate-50 px-3 py-4 text-slate-600">Consultando el pago…</p>}
        {source && <>
          <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[1fr_auto] sm:items-start sm:p-4">
            <div className="min-w-0"><p className="break-words font-semibold">{source.providerName}</p><p className="mt-0.5 break-words text-slate-600">{source.projectName} · {dateLabel(source.date)}</p>
              {source.concept && <p className="mt-1 break-words text-xs leading-relaxed text-slate-600">{source.concept}</p>}</div>
            <div className="border-t border-slate-200 pt-2 sm:border-0 sm:pt-0 sm:text-right"><p className="text-xs font-medium text-slate-500">Pago registrado</p>
              <p className="text-lg font-bold tabular-nums tracking-tight">ARS {money(source.amountCents)}</p><p className="text-xs text-slate-600">{source.cashBoxLabel}</p></div>
          </div>

          {canManage && (!active || active.status === 'preparing') && <form className="space-y-3 rounded-xl border border-slate-200 p-3 sm:p-4" onSubmit={event => {
            event.preventDefault();
            if (!confirmed || !source.signerEmail) return;
            void action('request', async isCurrent => {
              const result = await portalAdminRequest({ action: 'requestCashReceipt', ...scope, expectedFingerprint: source.fingerprint, attemptId: attempt.current,
                parts: { ars: mode === 'USD' ? 0 : Number(ars), usd: mode === 'ARS' ? 0 : Number(usd), rate: mode === 'ARS' ? 0 : Number(rate) } });
              if (!['requested', 'signed'].includes(result.status)) throw Error('El pago o la solicitud cambió. Actualizá el historial.');
              if (!isCurrent()) return;
              setNotice('El proveedor verá el pedido de firma en Mi proveedor → Documentos → Recibos.');
              await load();
            });
          }}>
            <h3 className="font-semibold">Solicitar la firma</h3>
            <label className="block font-medium">Efectivo entregado<select value={mode} disabled={Boolean(busy)} onChange={event => { setMode(event.target.value); setConfirmed(false); }} className={control}><option value="ARS">Pesos argentinos</option><option value="USD">Dólares estadounidenses</option><option value="mixed">Pesos y dólares</option></select></label>
            <div className="grid gap-3 sm:grid-cols-2">
              {mode !== 'USD' && <label className="block">Pesos (ARS)<input required type="number" min="0" step="0.01" value={ars} disabled={Boolean(busy)} onChange={event => { setArs(event.target.value); setConfirmed(false); }} className={control} /></label>}
              {mode !== 'ARS' && <><label className="block">Dólares (USD)<input required type="number" min="0.01" step="0.01" value={usd} disabled={Boolean(busy)} onChange={event => { setUsd(event.target.value); setConfirmed(false); }} className={control} /></label>
                <label className="block sm:col-span-2">Cotización usada (pesos por dólar)<input required type="number" min="0.000001" step="0.000001" value={rate} disabled={Boolean(busy)} onChange={event => { setRate(event.target.value); setConfirmed(false); }} className={control} /></label></>}
            </div>
            {mode !== 'ARS' && <p className="text-xs text-slate-600">El desglose tiene que equivaler a los ARS {money(source.amountCents)} registrados.</p>}
            <p className="break-words text-xs text-slate-600">{source.signerEmail ? <>Cuenta que firma <strong>{source.signerEmail}</strong></> : 'El proveedor tiene que completar su alta antes de firmar.'}</p>
            <label className="flex gap-2 rounded-lg bg-slate-50 p-2.5 text-sm"><input type="checkbox" required checked={confirmed} disabled={Boolean(busy)} onChange={event => setConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-blue-700" />Confirmo el efectivo entregado.</label>
            <button type="submit" disabled={Boolean(busy) || !confirmed || !source.signerEmail} className={`${primary} w-full sm:w-auto`}><FileSignature size={16} aria-hidden="true" />{busy === 'request' ? 'Preparando…' : active ? 'Completar solicitud' : 'Solicitar firma del recibo'}</button>
          </form>}

          {rows.map(receipt => {
            const isSigned = receipt.status === 'signed', pending = ['preparing', 'requested'].includes(receipt.status);
            const downloads: ReceiptFile[] = receipt.signed ? ['signed', 'original', 'certificate'] : ['original'];
            return <article key={receipt.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-start justify-between gap-2 px-3 pb-2 pt-3 sm:px-4">
                <h3 className="min-w-0 break-words font-semibold">{receipt.title}</h3>
                <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${isSigned ? 'bg-emerald-50 text-emerald-800' : pending ? 'bg-amber-50 text-amber-900' : 'bg-slate-100 text-slate-600'}`}>
                  {isSigned ? <CheckCircle2 size={14} aria-hidden="true" /> : pending ? <Clock3 size={14} aria-hidden="true" /> : null}{cashReceiptStatus(receipt.status)}
                </span>
              </div>
              {Boolean(receipt.signing) && <div className="grid grid-cols-2 gap-2 px-3 pb-3 sm:flex sm:flex-wrap sm:px-4">{downloads.map(artifact => {
                const { title, Icon } = files[artifact];
                const key = `${receipt.id}-${artifact}`;
                return <button key={artifact} type="button" disabled={Boolean(busy)} className={`${artifact === 'signed' ? primary : secondary} ${artifact === 'signed' || downloads.length === 1 ? 'col-span-2' : ''} max-sm:px-2 max-sm:text-xs`}
                  onClick={() => void action(key, async () => { downloadPortalFile(await portalAdminRequest({ action: 'cashReceiptFile', receiptId: receipt.id, artifact })); })}>
                  <Icon size={16} aria-hidden="true" />{busy === key ? 'Descargando…' : title}
                </button>;
              })}</div>}
              {canManage && receipt.status !== 'cancelled' && <div className="border-t border-slate-100 bg-slate-50/60 px-3 py-2 sm:px-4">
                {cancelling === receipt.id ? <form className="space-y-2" onSubmit={event => {
                  event.preventDefault();
                  if (!reason.trim()) return;
                  void action(`cancel-${receipt.id}`, async isCurrent => {
                    await portalAdminRequest({ action: 'cancelCashReceipt', receiptId: receipt.id, reason: reason.trim() });
                    if (!isCurrent()) return;
                    attempt.current = crypto.randomUUID(); setCancelling(''); setReason(''); setNotice('Recibo anulado.'); await load();
                  });
                }}>
                  <label className="block text-xs font-semibold text-slate-700">Motivo de anulación<textarea autoFocus required maxLength={300} rows={2} disabled={Boolean(busy)} value={reason} onChange={event => setReason(event.target.value)} className={control} /></label>
                  <div className="flex flex-wrap justify-end gap-2"><button type="button" disabled={Boolean(busy)} className={secondary} onClick={() => { setCancelling(''); setReason(''); }}>Volver</button>
                    <button type="submit" className={destroy} disabled={Boolean(busy) || !reason.trim()}><XCircle size={16} aria-hidden="true" />{busy === `cancel-${receipt.id}` ? 'Anulando…' : 'Confirmar anulación'}</button></div>
                </form> : <button type="button" disabled={Boolean(busy)} className={destroy} onClick={() => { setCancelling(receipt.id); setReason(''); }}><XCircle size={16} aria-hidden="true" />Anular recibo</button>}
              </div>}
            </article>;
          })}
          {!canManage && !rows.length && <p className="rounded-lg bg-slate-50 p-3 text-slate-600">Todavía no hay un recibo para este pago.</p>}
        </>}
        <footer className="flex justify-end border-t border-slate-100 pt-3"><button type="button" className={secondary} disabled={Boolean(busy)} onClick={() => void load()}><RefreshCw size={15} aria-hidden="true" className={busy === 'load' ? 'animate-spin' : undefined} />{busy === 'load' ? 'Actualizando…' : 'Actualizar estado'}</button></footer>
      </div>
    </ProjectDialog>}
  </>;
}

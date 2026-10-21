import { useEffect, useMemo, useRef, useState, type ReactNode, type FormEvent } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { Plus, X, Paperclip, Ban } from 'lucide-react';
import { db } from '../lib/firebase';
import { ProviderPaymentForm } from './ProviderPaymentForm';
import { providerDisplayName, inferLegacyIdentifiers } from '../lib/providerConstants';
import { discardStagedProviderFile, expenseAllocationKey, moneyCents, openProviderFile, providerFileHash, providerFinanceRequest, sharedInvoiceCapacity, uploadProviderFile, validateProviderFile, validateSharedAllocations } from '../lib/providerFinance';

const money = (cents: number) => (cents / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inputClass = 'w-full rounded border border-slate-200 px-3 py-2 text-sm focus:border-slate-600 outline-none';
const localToday = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
type Kind = 'invoice' | 'payment' | 'other';

export function ProviderFinancePanel({ provider, lines, onChanged }: { provider: any; lines: any[]; onChanged?: () => void }) {
  const [records, setRecords] = useState<any[]>([]);
  const [kind, setKind] = useState<Kind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Record<string, { amount: string; invoiceId: string }>>({});
  const [file, setFile] = useState<File | null>(null);
  const [currency, setCurrency] = useState('ARS');
  const [rate, setRate] = useState('1');
  const [net, setNet] = useState('');
  const paymentReceipt = useRef<File | null>(null);
  const attempt = useRef<{ id: string; payload?: Record<string, unknown>; file?: { path: string } }>({ id: crypto.randomUUID() });
  const [uncertain, setUncertain] = useState(false);
  const [formVersion, setFormVersion] = useState(0);
  useEffect(() => onSnapshot(query(collection(db, 'providerFinancialRecords'), where('providerId', '==', provider.id)), snapshot => {
    setRecords(snapshot.docs.map(row => ({ id: row.id, ...row.data() })).sort((a: any, b: any) => b.date.localeCompare(a.date)));
  }, () => setError('No se pudo consultar la documentación compartida.')), [provider.id]);
  const expenses = useMemo(() => lines.filter(line => line.expenseId && line.collectionName), [lines]);
  const allocated = (Object.values(selected) as Array<{ amount: string; invoiceId: string }>).reduce<number>((sum, row) => sum + moneyCents(row.amount), 0);
  const expected = Math.round(moneyCents(net) * (currency === 'USD' ? Number(rate) : 1));
  const start = (value: Kind) => {
    setKind(value); setFile(null); setSelected({}); setNet(''); setCurrency('ARS'); setRate('1'); setError(''); setUncertain(false);
    attempt.current = { id: crypto.randomUUID() };
    paymentReceipt.current = null;
    setFormVersion(value => value + 1);
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!kind || busy) return;
    const form = new FormData(event.currentTarget);
    setError(''); setBusy(true);
    try {
      if (!attempt.current.payload) {
        const allocations = expenses.filter(line => selected[expenseAllocationKey(line)]).map(line => ({
          projectId: line.projectId, collectionName: line.collectionName, itemId: line.expenseId,
          amount: Number(selected[expenseAllocationKey(line)].amount), invoiceId: selected[expenseAllocationKey(line)].invoiceId,
        }));
        if (kind !== 'other' && !validateSharedAllocations(allocations, expected / 100)) throw Error('La distribución debe sumar el neto aplicado en pesos.');
        if (kind !== 'payment' && !file) throw Error('Adjuntá el documento.');
        if (file) validateProviderFile(file);
        attempt.current.payload = { ...Object.fromEntries(form), action: 'create', id: attempt.current.id, kind, providerId: provider.id,
          currency, exchangeRate: currency === 'USD' ? Number(rate) : 1, net: Number(net), allocations };
      }
      if (file && !attempt.current.file) attempt.current.file = await uploadProviderFile(provider.id, attempt.current.id, file);
      await providerFinanceRequest({ ...attempt.current.payload, file: attempt.current.file || null });
      setKind(null); setUncertain(false); onChanged?.();
    } catch (error: any) {
      // An ambiguous network result may have committed. Retry the exact operation,
      // including its stable ID; never create a second payment on timeout.
      const isNetwork = ['functions/unavailable', 'functions/deadline-exceeded', 'functions/internal', 'storage/retry-limit-exceeded'].includes(error.code);
      if (isNetwork || uncertain) setUncertain(true);
      else {
        await discardStagedProviderFile(attempt.current.file);
        attempt.current = { id: crypto.randomUUID() }; setUncertain(false);
      }
      setError(error.message || 'No se pudo guardar.');
    } finally { setBusy(false); }
  };
  const cancel = async (record: any) => {
    const reason = window.prompt('Motivo de anulación. Se retirarán las aplicaciones de todos los proyectos y se conservará el original.');
    if (!reason?.trim()) return;
    setBusy(true); setError('');
    try { await providerFinanceRequest({ action: 'cancel', id: record.id, reason }); onChanged?.(); }
    catch (error: any) { setError(error.message || 'No se pudo anular.'); }
    finally { setBusy(false); }
  };
  const savePayment = async (payload: Record<string, unknown> | null, receipt: File | null) => {
    if (busy) return;
    setError(''); setBusy(true);
    try {
      if (!attempt.current.payload) {
        if (!payload) throw Error('Volvé a abrir la carga del pago.');
        if (payload.method === 'transfer' && !receipt) throw Error('Adjuntá el comprobante de pago.');
        const reference = payload.method === 'transfer' ? `comprobante-${await providerFileHash(receipt!)}` : `efectivo-${attempt.current.id}`;
        attempt.current.payload = { ...payload, action: 'create', id: attempt.current.id, kind: 'payment', providerId: provider.id,
          reference };
        paymentReceipt.current = receipt;
      }
      if (paymentReceipt.current && !attempt.current.file) attempt.current.file = await uploadProviderFile(provider.id, attempt.current.id, paymentReceipt.current);
      await providerFinanceRequest({ ...attempt.current.payload, file: attempt.current.file || null });
      setKind(null); setUncertain(false); onChanged?.();
    } catch (error: any) {
      const isNetwork = ['functions/unavailable', 'functions/deadline-exceeded', 'functions/internal', 'storage/retry-limit-exceeded'].includes(error.code);
      if (isNetwork || uncertain) setUncertain(true);
      else { await discardStagedProviderFile(attempt.current.file); attempt.current = { id: crypto.randomUUID() }; setUncertain(false); }
      setError(error.message || 'No se pudo registrar el pago.');
    } finally { setBusy(false); }
  };
  return <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="font-bold text-sm">Facturas, pagos y comprobantes</h3><p className="text-xs text-slate-500">Una carga, con aplicaciones a uno o varios proyectos. No agrega costos ni registra movimientos en CT.</p></div>
      <div className="flex flex-wrap gap-2">{(['invoice', 'payment', 'other'] as Kind[]).map(value => <button key={value} type="button" disabled={busy || uncertain} onClick={() => start(value)} className="flex items-center gap-1 rounded border px-3 py-2 text-xs font-bold hover:bg-slate-50 disabled:opacity-40"><Plus size={14}/>{value === 'invoice' ? 'Factura' : value === 'payment' ? 'Pago' : 'Comprobante'}</button>)}</div>
    </div>
    {error && <p role="alert" className="rounded bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {kind === 'payment' && <div key={formVersion}><ProviderPaymentForm provider={provider} lines={expenses} invoices={records} busy={busy} uncertain={uncertain} onClose={() => setKind(null)} onSave={savePayment}/></div>}
    {kind && kind !== 'payment' && <form key={formVersion} onSubmit={submit} className="rounded-lg border border-slate-200 p-4 space-y-4">
      <div className="flex justify-between"><h4 className="text-sm font-bold">{kind === 'invoice' ? 'Nueva factura' : 'Nuevo comprobante'}</h4><button type="button" disabled={busy || uncertain} onClick={() => setKind(null)} aria-label="Cerrar carga"><X size={18}/></button></div>
      <fieldset disabled={busy || uncertain} className="space-y-4 disabled:opacity-60">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Fecha"><input name="date" type="date" required defaultValue={localToday()} className={inputClass}/></Field>
          {kind !== 'other' && <><Field label="Moneda del documento"><select value={currency} onChange={event => setCurrency(event.target.value)} className={inputClass}><option>ARS</option><option>USD</option></select></Field>
          {currency === 'USD' && <Field label="Cotización ARS por USD"><input type="number" step="0.0001" min="0.0001" required value={rate} onChange={event => setRate(event.target.value)} className={inputClass}/></Field>}</>}
          {kind === 'invoice' && <>
            <Field label="Emisor fiscal"><input name="issuerName" required defaultValue={providerDisplayName(provider)} className={inputClass}/></Field>
            <Field label="CUIT del emisor"><input name="issuerCuit" required defaultValue={inferLegacyIdentifiers(provider).cuitNormalized || ''} className={inputClass}/></Field>
            <Field label="CUIT de la empresa receptora"><input name="recipientCuit" required placeholder="CUIT de quien recibe la factura" className={inputClass}/></Field>
            <Field label="Tipo y número"><input name="number" required placeholder="C 00001-00000123" className={inputClass}/></Field>
          </>}
          {kind !== 'other' && <>
            <Field label="Neto del costo (sin IVA recuperable)"><input type="number" min="0.01" step="0.01" required value={net} onChange={event => setNet(event.target.value)} className={inputClass}/></Field>
            <Field label="Total fiscal (con IVA)"><input name="total" type="number" min="0.01" step="0.01" required className={inputClass}/></Field>
          </>}
        </div>
        <Field label={kind === 'other' ? 'Detalle del comprobante (ej.: retención y factura)' : 'Notas'}><textarea name="notes" required={kind === 'other'} maxLength={2000} className={inputClass}/></Field>
        <Field label="Documento original · PDF o imagen · hasta 2 MB"><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required onChange={event => setFile(event.target.files?.[0] || null)} className="text-sm"/></Field>
        <div className="space-y-2">
          <h5 className="text-xs font-bold">Aplicar a gastos existentes · importes en pesos</h5>
          {expenses.map(line => {
            const rowKey = expenseAllocationKey(line), value = selected[rowKey];
            const capacity = kind === 'invoice' ? sharedInvoiceCapacity(line) : line.debt;
            return <div key={rowKey} className={`grid gap-2 rounded border p-3 md:grid-cols-[1fr_150px_220px] ${value ? 'border-indigo-200 bg-indigo-50/30' : 'border-slate-100'}`}>
              <label className="flex gap-2 text-xs"><input type="checkbox" checked={!!value} onChange={event => setSelected(current => {
                const next = { ...current }; if (event.target.checked) next[rowKey] = { amount: String(capacity || line.total), invoiceId: '' }; else delete next[rowKey]; return next;
              })}/><span><strong>{line.projectName}</strong><span className="block text-slate-500">{line.description} · {kind === 'invoice' ? 'Sin facturar' : 'Saldo'} ${capacity.toLocaleString('es-AR')}</span></span></label>
              {value && <><input aria-label={`Aplicar a ${line.projectName}: ${line.description}`} type="number" min="0.01" step="0.01" max={kind !== 'other' ? capacity : undefined} required value={value.amount} onChange={event => setSelected(current => ({ ...current, [rowKey]: { ...value, amount: event.target.value } }))} className={inputClass}/>
              </>}
            </div>;
          })}
          {!expenses.length && <p className="text-sm text-slate-500">No hay gastos activos asociados a este proveedor. Podés guardar un comprobante general.</p>}
          {kind !== 'other' && <p className={`text-sm font-bold ${allocated === expected && expected > 0 ? 'text-emerald-700' : 'text-amber-700'}`}>Aplicado: ${money(allocated)} / Neto en pesos: ${money(expected)} · Diferencia: ${money(expected - allocated)}</p>}
        </div>
      </fieldset>
      {uncertain && <p className="text-sm text-amber-800">No se confirmó la respuesta. Reintentá para recuperar la misma operación sin duplicarla.</p>}
      <button type="submit" disabled={busy} className="rounded bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Guardando…' : uncertain ? 'Verificar / reintentar' : 'Guardar y aplicar'}</button>
    </form>}
    <div className="divide-y divide-slate-100">{records.map(record => <div key={record.id} className={`py-3 text-sm ${record.status === 'cancelled' ? 'opacity-50' : ''}`}>
      <div className="flex flex-wrap justify-between gap-2"><strong>{record.kind === 'invoice' ? record.number : record.kind === 'payment' ? 'Pago' : 'Comprobante'} · {record.date} {record.status === 'cancelled' && '· Anulado'}</strong><div className="flex gap-3">{record.file && <button type="button" className="inline-flex items-center gap-1 text-blue-700" onClick={() => openProviderFile(record.id).catch(() => setError('No se pudo descargar el documento.'))}><Paperclip size={14}/>Descargar</button>}{record.status === 'active' && <button type="button" disabled={busy} className="inline-flex items-center gap-1 text-rose-700" onClick={() => cancel(record)}><Ban size={14}/>Anular</button>}</div></div>
      <p className="text-xs text-slate-500">{record.issuerName && `Emisor: ${record.issuerName} · `}{record.payeeName && `Destinatario: ${record.payeeName} · `}{record.currency} {money(record.totalCents)}{record.kind !== 'other' && ` · Neto aplicado ARS ${money(record.netArsCents)}`}</p>
      {record.notes && <p className="mt-1 text-xs">{record.notes}</p>}
      <div className="mt-2 flex flex-wrap gap-2">{record.allocations.map((row: any) => <a key={expenseAllocationKey(row)} href={`#/proyectos/${row.projectId}`} className="rounded bg-slate-50 px-2 py-1 text-xs hover:underline">{row.projectName} · ${money(row.amountCents)}</a>)}</div>
    </div>)}{!records.length && <p className="text-xs text-slate-400">Todavía no hay documentos centralizados. Los adjuntos anteriores se conservan en el detalle de cada proyecto.</p>}</div>
  </section>;
}
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block space-y-1"><span className="block text-xs text-slate-500">{label}</span>{children}</label>; }

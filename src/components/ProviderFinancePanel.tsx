import { ProviderThirdParties } from './ProviderThirdParties';
import { portalAdminRequest } from '../lib/providerPortal';
import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { Plus } from 'lucide-react';
import { ProviderFinancialRecordList } from './ProviderFinancialRecordList';
import { ProviderDocumentUploadForm } from './ProviderDocumentUploadForm';
import { allocateProviderDocument } from '../lib/providerDocumentSelection';
import { db } from '../lib/firebase';
import { ProviderPaymentForm } from './ProviderPaymentForm';
import { providerDisplayName } from '../lib/providerConstants';
import { discardStagedProviderFile, expenseAllocationKey, moneyCents, openProviderFile, providerFileHash, providerFinanceRequest, uploadProviderFile, validateProviderFile } from '../lib/providerFinance';

const localToday = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
type Kind = 'invoice' | 'payment' | 'other';

export function ProviderFinancePanel({ provider, lines, onChanged }: { provider: any; lines: any[]; onChanged?: () => void }) {
  const [authorizations,setAuthorizations]=useState<any[]>([]);
  useEffect(()=>{portalAdminRequest({action:'authorizations',providerId:provider.id}).then(r=>setAuthorizations(r.authorizations)).catch(()=>setAuthorizations([]));},[provider.id]);
  const [records, setRecords] = useState<any[]>([]);
  const [kind, setKind] = useState<Kind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const paymentReceipt = useRef<File | null>(null);
  const attempt = useRef<{ id: string; payload?: Record<string, unknown>; file?: { path: string } }>({ id: crypto.randomUUID() });
  const [uncertain, setUncertain] = useState(false);
  const [formVersion, setFormVersion] = useState(0);
  useEffect(() => onSnapshot(query(collection(db, 'providerFinancialRecords'), where('providerId', '==', provider.id)), snapshot => {
    setRecords(snapshot.docs.map(row => ({ id: row.id, ...row.data() })).sort((a: any, b: any) => b.date.localeCompare(a.date)));
  }, () => setError('No se pudo consultar la documentación compartida.')), [provider.id]);
  const expenses = useMemo(() => lines.filter(line => line.expenseId && line.collectionName), [lines]);
  const start = (value: Kind) => {
    setKind(value); setError(''); setUncertain(false);
    attempt.current = { id: crypto.randomUUID() };
    paymentReceipt.current = null;
    setFormVersion(value => value + 1);
  };
  const saveDocument = async (file: File | null, projectIds: string[]) => {
    if (!kind || kind === 'payment' || busy) return;
    setError(''); setBusy(true);
    try {
      if (!attempt.current.payload) {
        if (!file) throw Error('Adjuntá el documento.');
        validateProviderFile(file);
        const allocations = allocateProviderDocument(expenses, kind, projectIds, records);
        const candidates = kind === 'invoice' && provider.type === 'persona' ? authorizations.filter(a => a.valid && a.effectiveRoles.includes('invoice')
          && allocations.every(row => a.content.workKeys.includes(`${row.projectId}/${row.collectionName}/${row.itemId}`))) : [];
        const required = kind === 'invoice' && expenses.some(line => line.item?.thirdPartyPayoutRequired
          && allocations.some(row => expenseAllocationKey(row) === expenseAllocationKey(line)));
        if (candidates.length > 1) throw Error('Estos trabajos tienen más de un emisor autorizado. Revisá su autorización antes de cargar la factura.');
        if (required && !candidates.length) throw Error('Falta una autorización revisada del tercero que incluya estos trabajos.');
        const net = allocations.reduce((sum, row) => sum + moneyCents(row.amount), 0) / 100;
        attempt.current.payload = { action: 'create', id: attempt.current.id, kind, providerId: provider.id, documentOnly: true,
          date: localToday(), net, allocations, ...(candidates.length === 1 ? { thirdPartyAuthorizationId: candidates[0].id } : {}) };
      }
      if (file && !attempt.current.file) attempt.current.file = await uploadProviderFile(provider.id, attempt.current.id, file);
      await providerFinanceRequest({ ...attempt.current.payload, file: attempt.current.file || null });
      setKind(null); setUncertain(false); onChanged?.();
    } catch (error: any) {
      const isNetwork = ['functions/unavailable', 'functions/deadline-exceeded', 'functions/internal', 'storage/retry-limit-exceeded'].includes(error.code);
      if (isNetwork || uncertain) setUncertain(true);
      else { await discardStagedProviderFile(attempt.current.file); attempt.current = { id: crypto.randomUUID() }; setUncertain(false); }
      throw new Error(error.message || 'No se pudo guardar el documento.');
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
  return <section className="space-y-4">
      {authorizations.length > 0 && <details className="rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-xs font-medium text-slate-600">Quién factura y cobra por este proveedor</summary><div className="mt-3"><ProviderThirdParties providerId={provider.id} authorizations={authorizations} /></div></details>}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-sm font-medium text-slate-500">{providerDisplayName(provider)}</h3>
      <div className="flex flex-wrap gap-2">{(['invoice', 'payment', 'other'] as Kind[]).map(value => <button key={value} type="button" disabled={busy || uncertain} onClick={() => start(value)} className={`flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-40 ${value === 'invoice' ? 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}><Plus size={14}/>{value === 'invoice' ? 'Factura' : value === 'payment' ? 'Pago' : 'Comprobante'}</button>)}</div>
    </div>
    {error && <p role="alert" className="rounded bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {kind === 'payment' && <div key={formVersion}><ProviderPaymentForm authorizations={provider.type==='persona'?authorizations.filter(a=>a.valid&&a.effectiveRoles.includes('payment')&&a.effectiveRoles.includes('invoice')):[]} provider={provider} lines={expenses} invoices={records} busy={busy} uncertain={uncertain} onClose={() => setKind(null)} onSave={savePayment}/></div>}
    {kind && kind !== 'payment' && <div key={formVersion}><ProviderDocumentUploadForm kind={kind} lines={expenses} records={records} busy={busy} uncertain={uncertain} onClose={() => setKind(null)} onSave={saveDocument} /></div>}
    <ProviderFinancialRecordList records={records} busy={busy || uncertain} onOpen={openProviderFile} onCancel={cancel} />
  </section>;
}

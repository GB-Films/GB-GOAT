import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { getDownloadURL, ref } from 'firebase/storage';
import { db, storage } from '../../lib/firebase';
import { useAuth } from '../../context/AuthContext';
import { useAdministrativeDocuments } from '../../hooks/useAdministrativeDocuments';
import { AdministrativeDocumentList, AdministrativeDocumentUpload } from '../../components/AdministrativeDocumentControls';
import {
  administrationAction, administrationActionLabel, emptyProjectAdministration, invoiceBalance, localDateKey,
  normalizeProjectAdministration, resolvedInvoiceDueDate, unbilledAmount, validateAdministration,
  type CustomerCollection, type CustomerInvoice, type ProjectAdministrationRecord,
} from '../../lib/projectAdministration';

const today = () => localDateKey();
const money = (amount: number, currency: string) => new Intl.NumberFormat('es-AR', { style: 'currency', currency }).format(amount || 0);
const documentLink = (reference: string) => /^https:\/\//i.test(reference) ? <a href={reference} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 underline">Abrir respaldo</a> : reference || 'Sin respaldo';
const fileLink = (path?: string) => path ? <button type="button" className="font-semibold text-blue-700 underline" onClick={async () => {
  const tab = window.open('', '_blank');
  try {
    const url = await getDownloadURL(ref(storage, path));
    if (tab) tab.location.href = url;
    else window.location.href = url;
  } catch { tab?.close(); alert('No se pudo abrir el archivo.'); }
}}>Abrir archivo</button> : null;
const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none';
const labelClass = 'block space-y-1 text-xs font-semibold text-slate-600';

type Props = { projectId: string; projectName: string; clientName?: string; isAdmin: boolean };

export function ProjectAdministration({ projectId, projectName, clientName, isAdmin }: Props) {
  const { user } = useAuth();
  const [record, setRecord] = useState<ProjectAdministrationRecord | null>(null);
  const [exists, setExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [invoiceDraft, setInvoiceDraft] = useState<CustomerInvoice | null>(null);
  const [collectionDraft, setCollectionDraft] = useState<CustomerCollection | null>(null);
  const projectDocuments = useAdministrativeDocuments('project', projectId);

  useEffect(() => {
    if (!isAdmin || !projectId) return;
    let active = true;
    setLoading(true);
    setError('');
    getDoc(doc(db, 'projectAdministration', projectId)).then(snapshot => {
      if (!active) return;
      setExists(snapshot.exists());
      setRecord({ ...normalizeProjectAdministration(projectId, snapshot.exists() ? snapshot.data() : emptyProjectAdministration(projectId)), clientLegalName: clientName?.trim() || '' });
    }).catch(() => {
      if (active) setError('No pudimos leer la administración del proyecto. Reintentá antes de cargar datos.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId, clientName, isAdmin]);

  if (!isAdmin) return null;
  if (loading) return <div className="rounded-xl border border-slate-200 bg-white p-6">Cargando administración…</div>;
  if (!record) return <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-rose-800">{error}</div>;

  const change = <K extends keyof ProjectAdministrationRecord>(key: K, value: ProjectAdministrationRecord[K]) => {
    setRecord(current => current ? { ...current, [key]: value } : current);
    setMessage('');
  };

  const save = async () => {
    const candidate = { ...record, clientLegalName: clientName?.trim() || '' };
    const validation = validateAdministration(candidate);
    if (validation) { setError(validation); return; }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const ref = doc(db, 'projectAdministration', projectId);
      const nextRevision = await runTransaction(db, async transaction => {
        const current = await transaction.get(ref);
        const revision = Number(current.data()?.revision || 0);
        if ((current.exists() && revision !== record.revision) || (!current.exists() && record.revision !== 0)) throw new Error('CONFLICT');
        transaction.set(ref, { ...candidate, revision: revision + 1, updatedBy: user?.email || '', updatedAt: serverTimestamp() });
        return revision + 1;
      });
      setRecord({ ...candidate, revision: nextRevision, updatedBy: user?.email || '' });
      setExists(true);
      setMessage('Administración guardada. El dashboard mostrará el nuevo estado.');
    } catch (cause) {
      setError(cause instanceof Error && cause.message === 'CONFLICT'
        ? 'Alguien actualizó este proyecto. Recargá la página para revisar los cambios antes de guardar.'
        : 'No se pudo guardar. Los datos siguen en pantalla para que puedas reintentar.');
    } finally { setSaving(false); }
  };

  const addInvoice = () => setInvoiceDraft({ id: crypto.randomUUID(), number: '', issueDate: today(), sentDate: '', portalDate: '', amount: 0, netAmount: null, currency: 'ARS', dueDate: '', documentRef: '', documentPath: '', ctRef: '' });
  const addCollection = (invoiceId: string) => setCollectionDraft({ id: crypto.randomUUID(), invoiceId, date: today(), appliedAmount: 0, netReceived: 0, withholding: 0, reference: '', documentRef: '' });
  const upsertInvoice = () => {
    if (!invoiceDraft) return;
    const next = record.invoices.filter(item => item.id !== invoiceDraft.id).concat(invoiceDraft);
    const candidate = { ...record, invoices: next };
    const validation = validateAdministration(candidate);
    if (validation) { setError(validation); return; }
    setRecord(candidate);
    setInvoiceDraft(null);
    setError('');
    setMessage('Factura agregada al formulario. Guardá los cambios.');
  };
  const upsertCollection = () => {
    if (!collectionDraft) return;
    const next = record.collections.filter(item => item.id !== collectionDraft.id).concat(collectionDraft);
    const candidate = { ...record, collections: next };
    const validation = validateAdministration(candidate);
    if (validation) { setError(validation); return; }
    setRecord(candidate);
    setCollectionDraft(null);
    setError('');
    setMessage('Cobro agregado al formulario. Guardá los cambios.');
  };

  const action = administrationAction(exists ? record : null, today());
  const openInvoices = record.invoices.filter(invoice => invoiceBalance(record, invoice) > 0.009);
  const totals = Array.from(new Set<string>(record.invoices.map(invoice => invoice.currency))).map(currency => ({
    currency,
    billed: record.invoices.filter(invoice => invoice.currency === currency).reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0),
    pending: openInvoices.filter(invoice => invoice.currency === currency).reduce((sum, invoice) => sum + invoiceBalance(record, invoice), 0),
  }));

  return <div className="space-y-4 pb-20">
    <header className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Cliente · OC · Facturación · Cobros</p>
          <h2 className="mt-1 text-xl font-bold text-slate-900">Administración de {projectName}</h2>
          <p className="mt-1 text-xs text-slate-500">Registrá aquí las condiciones y enlazá los originales. Los pagos reales se concilian en Control Total.</p>
          <Link to="/clientes" className="mt-2 inline-block text-xs font-semibold text-blue-700 hover:underline">Ver fichas generales de Clientes</Link>
        </div>
        <span className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700">{administrationActionLabel[action]}</span>
      </div>
      {totals.length > 0 && <div className="mt-4 flex flex-wrap gap-3">{totals.map(total => <div key={total.currency} className="rounded-lg bg-slate-50 px-3 py-2 text-xs"><span className="text-slate-500">{total.currency} facturado</span> <b>{money(total.billed, total.currency)}</b><span className="ml-3 text-slate-500">saldo</span> <b>{money(total.pending, total.currency)}</b></div>)}</div>}
      {record.agreedAmount !== null && record.agreedCurrency && <p className="mt-3 text-xs text-slate-600">{record.agreedAmountTaxBasis === 'net' ? 'Valor a facturar: ' : 'Importe histórico con impuestos: '}<b>{money(record.agreedAmount, record.agreedCurrency)}</b>{record.agreedAmountTaxBasis === 'net' && ' + IVA si corresponde'} · Restante neto por facturar: <b>{unbilledAmount(record) === null ? 'pendiente de conciliar' : money(unbilledAmount(record) || 0, record.agreedCurrency)}</b></p>}
    </header>

    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h3 className="text-sm font-bold text-slate-900">1 · Datos para facturar y cobrar</h3>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <div className={labelClass}><span>Cliente del proyecto</span><div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">{clientName?.trim() || 'Completá el cliente en los datos del proyecto'}</div></div>
        <label className={labelClass}>Empresa que factura<select className={inputClass} value={['Gran Berta SRL', 'BANI VFX LLC', 'Sin factura'].includes(record.issuerEntity) ? record.issuerEntity : ''} onChange={event => change('issuerEntity', event.target.value)}><option value="">Seleccionar</option><option value="Gran Berta SRL">Gran Berta SRL</option><option value="BANI VFX LLC">BANI VFX LLC</option><option value="Sin factura">Sin factura</option></select></label>
        <label className={labelClass}>Total a facturar · sin IVA<input className={inputClass} type="number" min="0" step="0.01" value={record.agreedAmountTaxBasis === 'net' ? record.agreedAmount ?? '' : ''} onChange={event => setRecord(current => current ? { ...current, agreedAmount: event.target.value === '' ? null : Number(event.target.value), agreedAmountTaxBasis: 'net' } : current)} placeholder="Importe neto aprobado" /></label>
        <label className={labelClass}>Moneda<select className={inputClass} value={record.agreedCurrency} onChange={event => change('agreedCurrency', event.target.value as ProjectAdministrationRecord['agreedCurrency'])}><option value="">Sin confirmar</option><option value="ARS">ARS</option><option value="USD">USD</option></select></label>
        <label className={labelClass}>Días de pago<input className={inputClass} type="number" min="0" step="1" value={record.paymentTermDays ?? ''} onChange={event => change('paymentTermDays', event.target.value === '' ? null : Number(event.target.value))} placeholder="Sin confirmar" /></label>
      </div>
      <p className="text-xs text-slate-500">El total es neto; agregar IVA cuando corresponda. Las facturas emitidas conservan su importe final. El vencimiento se calcula sólo si su base está confirmada o si se carga una fecha verificada en cada factura.</p>
      {record.agreedAmountTaxBasis === 'gross' && record.agreedAmount !== null && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">El importe histórico de {money(record.agreedAmount, record.agreedCurrency || 'ARS')} incluía impuestos. Verificá el neto antes de completarlo; no se convierte automáticamente.</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1"><p className="text-xs font-semibold text-slate-600">Propuesta aprobada</p><AdministrativeDocumentUpload kind="agreement" title={`${projectName} · Propuesta aprobada`} upload={projectDocuments.upload} uploading={projectDocuments.uploading} onUploaded={document => change('agreementFilePath', document.path)} />{fileLink(record.agreementFilePath)}</div>
        <div className="space-y-1"><p className="text-xs font-semibold text-slate-600">Orden de compra</p><AdministrativeDocumentUpload kind="purchase_order" title={`${projectName} · Orden de compra`} upload={projectDocuments.upload} uploading={projectDocuments.uploading} onUploaded={document => setRecord(current => current ? { ...current, orderFilePath: document.path, orderStatus: 'confirmed' } : current)} />{fileLink(record.orderFilePath)}</div>
      </div>
      <label className={labelClass}>Nota sobre la orden de compra<input className={inputClass} value={record.orderRef} onChange={event => change('orderRef', event.target.value)} placeholder="Aclaración opcional" /></label>
      <label className={labelClass}>Requisitos para facturar<textarea className={inputClass} rows={2} value={record.billingRequirement} onChange={event => change('billingRequirement', event.target.value)} placeholder="OC, recepción, portal u otro requisito" /></label>
      <label className={labelClass}>Notas administrativas<textarea className={inputClass} rows={3} value={record.notes} onChange={event => change('notes', event.target.value)} /></label>
    </section>

    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 sm:px-5"><div><h3 className="text-sm font-bold text-slate-900">2 · Facturas emitidas al cliente</h3><p className="text-xs text-slate-500">Emisión, envío o carga en portal, vencimiento y saldo. No incluye facturas de proveedores.</p></div><button type="button" onClick={addInvoice} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white">Agregar factura</button></div>
      <div className="divide-y divide-slate-100">{record.invoices.map(invoice => <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5"><div><b className="text-sm text-slate-900">{invoice.number}</b><p className="text-xs text-slate-500">Emitida {invoice.issueDate} · {invoice.sentDate ? `enviada ${invoice.sentDate}` : invoice.portalDate ? `portal ${invoice.portalDate}` : 'sin presentación registrada'} · {resolvedInvoiceDueDate(record, invoice) ? `vence ${resolvedInvoiceDueDate(record, invoice)}${invoice.dueDate ? '' : ' (calculado)'}` : 'plazo sin confirmar'}</p><p className="text-xs text-slate-500">{invoice.documentRef ? documentLink(invoice.documentRef) : invoice.documentPath ? fileLink(invoice.documentPath) : 'Sin respaldo'}{invoice.documentPath && invoice.documentRef && <> · {fileLink(invoice.documentPath)}</>}{invoice.ctRef && ` · CT: ${invoice.ctRef}`}</p></div><div className="flex items-center gap-3"><div className="text-right"><b className="text-sm">{money(invoice.amount, invoice.currency)}</b><p className="text-xs text-rose-700">Saldo {money(invoiceBalance(record, invoice), invoice.currency)}</p></div><button type="button" onClick={() => setInvoiceDraft({ ...invoice })} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold">Editar</button><button type="button" onClick={() => addCollection(invoice.id)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold">Cobro</button></div></div>)}{record.invoices.length === 0 && <p className="p-5 text-xs text-slate-500">Todavía no hay facturas registradas.</p>}</div>
    </section>

    <section className="rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 p-4 sm:px-5"><h3 className="text-sm font-bold text-slate-900">3 · Cobros y retenciones</h3><p className="text-xs text-slate-500">Aplicá cobros parciales a su factura. Neto recibido + retención = importe aplicado.</p></div><div className="divide-y divide-slate-100">{record.collections.map(item => { const invoice = record.invoices.find(candidate => candidate.id === item.invoiceId); return <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5"><div><b className="text-xs">{invoice?.number || 'Factura no encontrada'} · {item.date}</b><p className="text-xs text-slate-500">{item.reference || 'Sin referencia'} · {documentLink(item.documentRef)}</p></div><div className="flex items-center gap-3"><div className="text-right text-xs">Aplicado <b>{money(item.appliedAmount, invoice?.currency || 'ARS')}</b><br />Neto {money(item.netReceived, invoice?.currency || 'ARS')} · retención {money(item.withholding, invoice?.currency || 'ARS')}</div><button type="button" onClick={() => setCollectionDraft({ ...item })} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold">Editar</button></div></div>; })}{record.collections.length === 0 && <p className="p-5 text-xs text-slate-500">No hay cobros aplicados.</p>}</div></section>

    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><h3 className="mb-1 text-sm font-bold text-slate-900">4 · Archivos administrativos del proyecto</h3><p className="mb-4 text-xs text-slate-500">Propuestas, OC y facturas cargadas en este proyecto. Los originales se conservan en su archivo de administración.</p><AdministrativeDocumentList {...projectDocuments} /></section>

    <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-xl backdrop-blur"><div role="status" className={`text-xs ${error ? 'text-rose-700' : 'text-slate-600'}`}>{error || message || 'Los cambios se guardan con el botón.'}</div><button type="button" disabled={saving} onClick={save} className="rounded-lg bg-blue-700 px-5 py-2.5 text-xs font-bold text-white disabled:opacity-50">{saving ? 'Guardando…' : 'Guardar administración'}</button></div>

    {invoiceDraft && <div role="dialog" aria-modal="true" aria-label="Factura del cliente" className="fixed inset-0 z-[350] flex items-center justify-center bg-slate-900/50 p-4"><div className="max-h-[90vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-xl bg-white p-5 shadow-2xl"><h3 className="text-lg font-bold">Factura del cliente</h3><div className="grid gap-3 sm:grid-cols-2">
      <label className={labelClass}>Número<input className={inputClass} value={invoiceDraft.number} onChange={event => setInvoiceDraft({ ...invoiceDraft, number: event.target.value })} /></label>
      <label className={labelClass}>Fecha de emisión<input className={inputClass} type="date" value={invoiceDraft.issueDate} onChange={event => setInvoiceDraft({ ...invoiceDraft, issueDate: event.target.value })} /></label>
      <label className={labelClass}>Importe<input className={inputClass} type="number" min="0" step="0.01" value={invoiceDraft.amount || ''} onChange={event => setInvoiceDraft({ ...invoiceDraft, amount: Number(event.target.value) })} /></label>
      <label className={labelClass}>Neto sin IVA<input className={inputClass} type="number" min="0" step="0.01" value={invoiceDraft.netAmount ?? ''} onChange={event => setInvoiceDraft({ ...invoiceDraft, netAmount: event.target.value === '' ? null : Number(event.target.value) })} placeholder="Para comparar con el total aprobado" /></label>
      <label className={labelClass}>Moneda<select className={inputClass} value={invoiceDraft.currency} onChange={event => setInvoiceDraft({ ...invoiceDraft, currency: event.target.value as CustomerInvoice['currency'] })}><option value="ARS">ARS</option><option value="USD">USD</option></select></label>
      <label className={labelClass}>Enviada por correo<input className={inputClass} type="date" value={invoiceDraft.sentDate} onChange={event => setInvoiceDraft({ ...invoiceDraft, sentDate: event.target.value })} /></label>
      <label className={labelClass}>Cargada al portal<input className={inputClass} type="date" value={invoiceDraft.portalDate} onChange={event => setInvoiceDraft({ ...invoiceDraft, portalDate: event.target.value })} /></label>
      <label className={labelClass}>Vencimiento verificado<input className={inputClass} type="date" value={invoiceDraft.dueDate} onChange={event => setInvoiceDraft({ ...invoiceDraft, dueDate: event.target.value })} /></label>
      <label className={labelClass}>Referencia del PDF<input className={inputClass} value={invoiceDraft.documentRef} onChange={event => setInvoiceDraft({ ...invoiceDraft, documentRef: event.target.value })} /></label>
      <div className="space-y-1"><p className="text-xs font-semibold text-slate-600">PDF de nuestra factura</p><AdministrativeDocumentUpload kind="invoice" title={`${projectName} · Factura ${invoiceDraft.number || 'sin número'}`} upload={projectDocuments.upload} uploading={projectDocuments.uploading} onUploaded={document => setInvoiceDraft(current => current ? { ...current, documentPath: document.path } : current)} />{fileLink(invoiceDraft.documentPath)}</div>
      <label className={labelClass}>Referencia en Control Total<input className={inputClass} value={invoiceDraft.ctRef} onChange={event => setInvoiceDraft({ ...invoiceDraft, ctRef: event.target.value })} /></label>
    </div><p className="text-xs text-slate-500">Dejá el vencimiento vacío si no surge de un documento o de una condición confirmada.</p><div className="flex justify-end gap-2"><button type="button" onClick={() => setInvoiceDraft(null)} className="rounded-lg border px-3 py-2 text-xs font-bold">Cancelar</button><button type="button" onClick={upsertInvoice} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white">Agregar al formulario</button></div></div></div>}

    {collectionDraft && <div role="dialog" aria-modal="true" aria-label="Cobro del cliente" className="fixed inset-0 z-[350] flex items-center justify-center bg-slate-900/50 p-4"><div className="w-full max-w-lg space-y-4 rounded-xl bg-white p-5 shadow-2xl"><h3 className="text-lg font-bold">Cobro / retención</h3><div className="grid gap-3 sm:grid-cols-2">
      <label className={labelClass}>Factura<select className={inputClass} value={collectionDraft.invoiceId} onChange={event => setCollectionDraft({ ...collectionDraft, invoiceId: event.target.value })}>{record.invoices.map(invoice => <option key={invoice.id} value={invoice.id}>{invoice.number}</option>)}</select></label>
      <label className={labelClass}>Fecha de cobro<input className={inputClass} type="date" value={collectionDraft.date} onChange={event => setCollectionDraft({ ...collectionDraft, date: event.target.value })} /></label>
      <label className={labelClass}>Neto recibido<input className={inputClass} type="number" min="0" step="0.01" value={collectionDraft.netReceived || ''} onChange={event => { const netReceived = Number(event.target.value); setCollectionDraft({ ...collectionDraft, netReceived, appliedAmount: Math.round((netReceived + collectionDraft.withholding) * 100) / 100 }); }} /></label>
      <label className={labelClass}>Retención<input className={inputClass} type="number" min="0" step="0.01" value={collectionDraft.withholding || ''} onChange={event => { const withholding = Number(event.target.value); setCollectionDraft({ ...collectionDraft, withholding, appliedAmount: Math.round((collectionDraft.netReceived + withholding) * 100) / 100 }); }} /></label>
      <label className={labelClass}>Referencia bancaria / CT<input className={inputClass} value={collectionDraft.reference} onChange={event => setCollectionDraft({ ...collectionDraft, reference: event.target.value })} /></label>
      <label className={labelClass}>Comprobante / certificado<input className={inputClass} value={collectionDraft.documentRef} onChange={event => setCollectionDraft({ ...collectionDraft, documentRef: event.target.value })} /></label>
    </div><p className="text-xs text-slate-600">Importe aplicado: <b>{collectionDraft.appliedAmount.toLocaleString('es-AR')}</b></p><div className="flex justify-end gap-2"><button type="button" onClick={() => setCollectionDraft(null)} className="rounded-lg border px-3 py-2 text-xs font-bold">Cancelar</button><button type="button" onClick={upsertCollection} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white">Agregar al formulario</button></div></div></div>}
  </div>;
}

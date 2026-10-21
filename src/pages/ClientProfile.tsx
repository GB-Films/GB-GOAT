import { useEffect, useState } from 'react';
import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { X } from 'lucide-react';
import { db } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { useAdministrativeDocuments } from '../hooks/useAdministrativeDocuments';
import { AdministrativeDocumentList, AdministrativeDocumentUpload } from '../components/AdministrativeDocumentControls';
import { administrativeDocumentKinds, type AdministrativeDocumentKind } from '../lib/administrativeDocuments';

type Client = { id: string; businessName?: string; cuit?: string; country?: string };
type ClientAdministration = {
  schemaVersion: 1;
  clientId: string;
  fiscalAddress: string;
  billingContactName: string;
  billingContactEmail: string;
  supplierPortalUrl: string;
  billingInstructions: string;
  paymentInstructions: string;
  notes: string;
  revision: number;
  updatedBy: string;
};

const emptyProfile = (clientId: string): ClientAdministration => ({
  schemaVersion: 1, clientId, fiscalAddress: '', billingContactName: '', billingContactEmail: '',
  supplierPortalUrl: '', billingInstructions: '', paymentInstructions: '', notes: '', revision: 0, updatedBy: '',
});
const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none';

export function ClientProfile({ client, onClose }: { client: Client; onClose: () => void }) {
  const { user } = useAuth();
  const [record, setRecord] = useState<ClientAdministration | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [documentKind, setDocumentKind] = useState<AdministrativeDocumentKind>('billing_guide');
  const [documentTitle, setDocumentTitle] = useState('');
  const documents = useAdministrativeDocuments('client', client.id);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getDoc(doc(db, 'clientAdministration', client.id)).then(snapshot => {
      if (active) setRecord({ ...emptyProfile(client.id), ...(snapshot.exists() ? snapshot.data() : {}) });
    }).catch(() => { if (active) setError('No pudimos leer la ficha. Reintentá.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client.id]);

  const change = (key: keyof ClientAdministration, value: string) => {
    setRecord(current => current ? { ...current, [key]: value } : current);
    setMessage('');
  };
  const save = async () => {
    if (!record || !user?.email) return;
    if (record.supplierPortalUrl && !/^https:\/\//i.test(record.supplierPortalUrl)) {
      setError('El portal debe comenzar con https://.'); return;
    }
    setSaving(true); setError(''); setMessage('');
    try {
      const nextRevision = await runTransaction(db, async transaction => {
        const documentRef = doc(db, 'clientAdministration', client.id);
        const current = await transaction.get(documentRef);
        const revision = Number(current.data()?.revision || 0);
        if (revision !== record.revision) throw new Error('CONFLICT');
        transaction.set(documentRef, { ...record, revision: revision + 1, updatedBy: user.email, updatedAt: serverTimestamp() });
        return revision + 1;
      });
      setRecord({ ...record, revision: nextRevision, updatedBy: user.email });
      setMessage('Ficha del cliente guardada.');
    } catch (cause) {
      setError(cause instanceof Error && cause.message === 'CONFLICT'
        ? 'Alguien actualizó esta ficha. Cerrá y volvé a abrir para revisar antes de guardar.'
        : 'No pudimos guardar la ficha. Reintentá.');
    } finally { setSaving(false); }
  };

  return <div role="dialog" aria-modal="true" aria-label={`Perfil de ${client.businessName || 'cliente'}`} className="fixed inset-0 z-[350] flex items-center justify-center bg-slate-950/50 p-3 sm:p-6">
    <div className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
      <header className="flex items-start justify-between gap-3 border-b border-slate-200 p-4 sm:p-5">
        <div><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Perfil corporativo</p><h2 className="text-xl font-bold text-slate-900">{client.businessName || 'Cliente'}</h2><p className="text-xs text-slate-500">CUIT {client.cuit || 'sin cargar'} · {client.country || 'País sin cargar'}</p></div>
        <button type="button" onClick={onClose} aria-label="Cerrar perfil" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
      </header>
      <div className="space-y-5 overflow-y-auto p-4 sm:p-5">
        {loading ? <p className="text-sm text-slate-500">Cargando ficha…</p> : record && <section className="space-y-3">
          <h3 className="text-sm font-bold text-slate-900">Datos para trabajar y facturar</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs font-semibold text-slate-600">Domicilio fiscal<input className={inputClass} value={record.fiscalAddress} onChange={event => change('fiscalAddress', event.target.value)} /></label>
            <label className="space-y-1 text-xs font-semibold text-slate-600">Portal de proveedores<input className={inputClass} type="url" value={record.supplierPortalUrl} onChange={event => change('supplierPortalUrl', event.target.value)} placeholder="https://…" /></label>
            <label className="space-y-1 text-xs font-semibold text-slate-600">Contacto administrativo<input className={inputClass} value={record.billingContactName} onChange={event => change('billingContactName', event.target.value)} /></label>
            <label className="space-y-1 text-xs font-semibold text-slate-600">Correo administrativo<input className={inputClass} type="email" value={record.billingContactEmail} onChange={event => change('billingContactEmail', event.target.value)} /></label>
          </div>
          <label className="block space-y-1 text-xs font-semibold text-slate-600">Requisitos habituales para facturar<textarea className={inputClass} rows={3} value={record.billingInstructions} onChange={event => change('billingInstructions', event.target.value)} /></label>
          <label className="block space-y-1 text-xs font-semibold text-slate-600">Condiciones habituales de pago<textarea className={inputClass} rows={2} value={record.paymentInstructions} onChange={event => change('paymentInstructions', event.target.value)} /></label>
          <label className="block space-y-1 text-xs font-semibold text-slate-600">Notas administrativas<textarea className={inputClass} rows={2} value={record.notes} onChange={event => change('notes', event.target.value)} /></label>
          <p className="text-xs text-slate-500">Estas indicaciones son generales; cada proyecto conserva su OC y plazo confirmado.</p>
          <div className="flex flex-wrap items-center justify-between gap-2"><p role="status" className={`text-xs ${error ? 'text-rose-700' : 'text-emerald-700'}`}>{error || message}</p><button type="button" disabled={saving} onClick={save} className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{saving ? 'Guardando…' : 'Guardar ficha'}</button></div>
        </section>}
        <section className="space-y-3 border-t border-slate-200 pt-5"><h3 className="text-sm font-bold text-slate-900">Documentación del cliente</h3><p className="text-xs text-slate-500">Instructivos, requisitos y certificados que se reutilizan en distintos proyectos.</p>
          <div className="grid gap-2 sm:grid-cols-[200px_1fr_auto] sm:items-end">
            <label className="space-y-1 text-xs font-semibold text-slate-600">Tipo<select className={inputClass} value={documentKind} onChange={event => setDocumentKind(event.target.value as AdministrativeDocumentKind)}>{(['billing_guide', 'supplier_guide', 'tax_certificate', 'other'] as const).map(kind => <option key={kind} value={kind}>{administrativeDocumentKinds[kind]}</option>)}</select></label>
            <label className="space-y-1 text-xs font-semibold text-slate-600">Título<input className={inputClass} value={documentTitle} onChange={event => setDocumentTitle(event.target.value)} placeholder="Ej.: Instructivo de facturación 2026" /></label>
            <AdministrativeDocumentUpload kind={documentKind} title={documentTitle} upload={documents.upload} uploading={documents.uploading} onUploaded={() => setDocumentTitle('')} />
          </div>
          <AdministrativeDocumentList {...documents} />
        </section>
      </div>
    </div>
  </div>;
}

import { useMemo, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { allocateProviderPayment, paymentProjectChoices, type PayableProviderLine } from '../lib/providerPaymentSelection';
import { moneyCents } from '../lib/sharedAllocations';
import { validateProviderFile } from '../lib/providerFinance';
import { providerDisplayName } from '../lib/providerConstants';

const inputClass = 'w-full rounded border border-slate-200 px-3 py-2 text-sm focus:border-slate-600 outline-none';
const money = (value: number) => (value / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };

export function ProviderPaymentForm({ authorizations=[], provider, lines, invoices, busy, uncertain, onClose, onSave }: {
  authorizations?:any[]; provider: any; lines: PayableProviderLine[]; invoices: any[]; busy: boolean; uncertain: boolean;
  onClose: () => void; onSave: (payload: Record<string, unknown> | null, file: File | null) => Promise<void>;
}) {
  const projects = useMemo(() => paymentProjectChoices(lines), [lines]);
  const [selectedIds, setSelectedIds] = useState(() => projects.map(project => project.id));
  const [amountOverride, setAmountOverride] = useState<string | null>(null);
  const selectedBalance = projects.filter(project => selectedIds.includes(project.id)).reduce((sum, project) => sum + project.balanceCents, 0);
  const amount = amountOverride ?? String(selectedBalance / 100);
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState('transfer');
  const [cashProject, setCashProject] = useState('');
  const [authorizationId,setAuthorizationId]=useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [preparing, setPreparing] = useState(false);
  const disabled = busy || uncertain || preparing;
  const chooseProjects = (ids: string[]) => { setSelectedIds(ids); setAmountOverride(null); setError(''); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || preparing) return;
    if (uncertain) { await onSave(null, null); return; }
    setError(''); setPreparing(true);
    try {
      const allocations = allocateProviderPayment(lines, selectedIds, Number(amount), invoices);
      if (method === 'transfer' && !file) throw Error('Adjuntá el comprobante de pago.');
      const appliedProjects = [...new Set(allocations.map(row => row.projectId))];
      const cashProjectId = appliedProjects.includes(cashProject) ? cashProject : appliedProjects[0];
      if (file && method === 'transfer') validateProviderFile(file);
      const beneficiaries = allocations.map(row => invoices.find(invoice => invoice.id === row.invoiceId)?.payeeName).filter(Boolean);
      const payeeName = beneficiaries.length === allocations.length && new Set(beneficiaries).size === 1 ? beneficiaries[0] : providerDisplayName(provider);
      const authority=authorizations.find(a=>a.id===authorizationId);
      if(authorizationId&&(!authority||allocations.some(a=>!authority.content.workKeys.includes(`${a.projectId}/${a.collectionName}/${a.itemId}`))))throw Error('La autorización no incluye todos los trabajos seleccionados.');
      await onSave({ ...(authority?{thirdPartyAuthorizationId:authority.id}:{}), date, method, currency: 'ARS', exchangeRate: 1, net: Number(amount), total: Number(amount),
        withheld: 0, fee: 0, payeeName:authority?.content.party.name||payeeName,
        account: method === 'cash' ? 'CTA003 | GB Pesos Efectivo' : 'Comprobante bancario',
        cashProjectId: method === 'cash' ? cashProjectId : '', allocations,
        notes: `Pago aplicado al saldo del proveedor en pesos. ${method === 'cash' ? 'Efectivo de Caja General.' : 'Comprobante adjunto; el importe aplicado corresponde al costo de GOAT, sin presumir el débito bancario ni el IVA.'}`,
      }, method === 'transfer' ? file : null);
    } catch (error: any) { setError(error.message || 'No se pudo preparar el pago.'); }
    finally { setPreparing(false); }
  };
  let appliedProjectIds: string[] = [];
  try { appliedProjectIds = [...new Set(allocateProviderPayment(lines, selectedIds, Number(amount)).map(row => row.projectId))]; } catch { /* Invalid amount is explained on submit. */ }
  const chosenProjects = projects.filter(project => appliedProjectIds.includes(project.id));
  const cashProjectId = chosenProjects.some(project => project.id === cashProject) ? cashProject : chosenProjects[0]?.id || '';
  return <form onSubmit={submit} className="rounded-lg border border-slate-200 p-4 space-y-4">
    <div className="flex justify-between items-center"><h4 className="text-sm font-bold">Registrar pago</h4><button type="button" disabled={disabled} onClick={onClose} aria-label="Cerrar carga"><X size={18}/></button></div>
    {error && <p role="alert" className="rounded bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    <fieldset disabled={disabled} className="space-y-4 disabled:opacity-60">
      {authorizations.length>0&&<label className="block text-xs">Beneficiario del pago<select className={inputClass} value={authorizationId} onChange={e=>setAuthorizationId(e.target.value)}><option value="">El proveedor / beneficiario habitual</option>{authorizations.map(a=><option key={a.id} value={a.id}>{a.content.party.name} · Autorización firmada</option>)}</select></label>}
      {!projects.length ? <p className="rounded bg-emerald-50 p-3 text-sm text-emerald-800">Este proveedor no tiene saldos pendientes.</p> : <>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs"><span className="font-bold">Proyectos a pagar</span><button type="button" className="text-blue-700 hover:underline" onClick={() => chooseProjects(selectedIds.length === projects.length ? [] : projects.map(project => project.id))}>{selectedIds.length === projects.length ? 'Limpiar' : 'Seleccionar todos'}</button></div>
          {projects.map(project => <label key={project.id} className={`flex items-center gap-3 rounded border p-3 text-sm ${selectedIds.includes(project.id) ? 'border-indigo-200 bg-indigo-50/30' : 'border-slate-100'}`}>
            <input type="checkbox" checked={selectedIds.includes(project.id)} onChange={event => chooseProjects(event.target.checked ? [...selectedIds, project.id] : selectedIds.filter(id => id !== project.id))}/>
            <span className="min-w-0 flex-1"><strong>{project.name}</strong><span className="block text-xs text-slate-500">{project.lines.map(line => line.description).join(' · ')}</span></span>
            <span className="shrink-0 font-mono">${money(project.balanceCents)}</span>
          </label>)}
          <p className="text-right text-sm font-bold">Saldo seleccionado: ${money(selectedBalance)}</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block space-y-1"><span className="block text-xs text-slate-500">Importe a aplicar (pesos)</span><input type="number" min="0.01" max={selectedBalance / 100} step="0.01" required value={amount} onChange={event => setAmountOverride(event.target.value)} className={inputClass}/></label>
          <label className="block space-y-1"><span className="block text-xs text-slate-500">Fecha de pago</span><input type="date" required value={date} onChange={event => setDate(event.target.value)} className={inputClass}/></label>
        </div>
        <div className="flex flex-wrap gap-5 text-sm"><label className="flex items-center gap-2"><input type="radio" name="payment-method" checked={method === 'transfer'} onChange={() => setMethod('transfer')}/>Comprobante de pago</label><label className="flex items-center gap-2"><input type="radio" name="payment-method" checked={method === 'cash'} onChange={() => setMethod('cash')}/>Efectivo</label></div>
        {method === 'transfer' ? <label className="block space-y-1"><span className="block text-xs text-slate-500">Comprobante · PDF o imagen · hasta 2 MB</span><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required onChange={event => setFile(event.target.files?.[0] || null)} className="block w-full text-sm"/></label>
          : <label className="block space-y-1"><span className="block text-xs text-slate-500">Caja de efectivo</span><select required value={cashProjectId} onChange={event => setCashProject(event.target.value)} className={inputClass}>{chosenProjects.map(project => <option key={project.id} value={project.id}>Caja General · {project.name}</option>)}</select></label>}
        {moneyCents(amount) > 0 && moneyCents(amount) < selectedBalance && <p className="text-xs text-slate-500">Pago parcial: se aplicará a los proyectos seleccionados en el orden mostrado. El resto conservará su saldo.</p>}
      </>}
    </fieldset>
    {uncertain && <p className="text-sm text-amber-800">No se confirmó la respuesta. Reintentá para recuperar el mismo pago sin duplicarlo.</p>}
    <button type="submit" disabled={busy || preparing || (!projects.length && !uncertain)} className="rounded bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy || preparing ? 'Guardando…' : uncertain ? 'Verificar / reintentar' : 'Registrar pago'}</button>
  </form>;
}

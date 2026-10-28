import { ClipboardCheck } from 'lucide-react';

export function ProviderConfirmationNotice({ status, onReview }: { status?: string; onReview: () => void }) {
  if (status !== 'required' && status !== 'pending_review') return null;
  return <aside role="status" className={`flex flex-wrap items-center gap-3 rounded-2xl border p-4 ${status === 'required' ? 'border-blue-200 bg-blue-50' : 'border-amber-200 bg-amber-50'}`}>
    <ClipboardCheck className="h-6 w-6 shrink-0" aria-hidden="true" />
    <div className="min-w-0 flex-1"><h2 className="font-semibold">{status === 'required' ? 'Revisá y confirmá tus datos' : 'Datos confirmados · cambios en revisión'}</h2>
      <p className="mt-1 text-sm text-slate-600">{status === 'required' ? 'Tu ficha ya estaba cargada. Revisá la información, corregí lo que haga falta y firmá la confirmación.' : 'Tu firma quedó guardada. Administración debe aprobar las correcciones de identidad o cuenta bancaria.'}</p></div>
    <button type="button" onClick={onReview} className={`rounded-xl px-4 py-2 text-sm font-semibold ${status === 'required' ? 'bg-blue-600 text-white hover:bg-blue-700' : 'border border-amber-200 bg-white'}`}>{status === 'required' ? 'Revisar mis datos' : 'Ver mis datos'}</button>
  </aside>;
}

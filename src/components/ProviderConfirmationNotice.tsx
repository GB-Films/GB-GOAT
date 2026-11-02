import { ClipboardCheck } from 'lucide-react';

export function ProviderConfirmationNotice({ status, onReview }: { status?: string; onReview: () => void }) {
  if (status !== 'required' && status !== 'pending_review') return null;
  return <aside role="status" className={`flex flex-wrap items-center gap-3 rounded-2xl border p-4 ${status === 'required' ? 'border-blue-200 bg-blue-50' : 'border-amber-200 bg-amber-50'}`}>
    <ClipboardCheck className="h-6 w-6 shrink-0" aria-hidden="true" />
    <div className="min-w-0 flex-1"><h2 className="font-semibold">{status === 'required' ? 'Revisá y confirmá tus datos' : 'Datos firmados · completar aplicación'}</h2>
      <p className="mt-1 text-sm text-slate-600">{status === 'required' ? 'Revisá tu ficha y firmá la confirmación.' : 'Tu firma quedó guardada. Completá la aplicación en Mis datos.'}</p></div>
    <button type="button" onClick={onReview} className={`portal-button ${status === 'required' ? 'portal-button-primary' : ''}`}>{status === 'required' ? 'Revisar mis datos' : 'Ver mis datos'}</button>
  </aside>;
}

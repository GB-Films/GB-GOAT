import { ClipboardCheck } from 'lucide-react';

export type ProviderDataReview = { required: boolean; fields: { field: string; label: string; message: string }[]; registrationPending?: boolean; classificationPending?: boolean };
export function ProviderConfirmationNotice({ status, review, onReview }: { status?: string; review?: ProviderDataReview; onReview: () => void }) {
  if (review?.required) return <aside role="status" className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 sm:p-4">
    <div className="flex flex-wrap items-center gap-3"><ClipboardCheck className="h-5 w-5 shrink-0" aria-hidden="true" /><div className="min-w-0 flex-1"><h2 className="font-semibold">Tenés datos para revisar</h2><p className="mt-1 text-xs sm:text-sm">Podés consultar tus trabajos y comprobantes mientras los revisás.</p></div><button type="button" onClick={onReview} className="portal-button">Revisar mis datos</button></div>
    {!!review.fields.length && <ul aria-label="Datos por revisar" className="flex flex-wrap gap-1.5">{review.fields.map(field => <li key={field.field} title={field.message} className="rounded border border-amber-200 bg-white/60 px-2 py-1 text-xs">{field.label}{field.field === 'bankAccount_cbu' ? ': 22 números' : ''}</li>)}</ul>}
    {review.registrationPending && <p className="text-xs">Revisá tu ficha y firmá su confirmación para completar la revisión.</p>}
    {review.classificationPending && <p className="text-xs">Administración debe completar la clasificación de esta ficha.</p>}
    {status === 'pending_review' && <p className="text-xs">Tenés datos firmados por aplicar en Mis datos.</p>}
  </aside>;
  if (status !== 'required' && status !== 'pending_review') return null;
  return <aside role="status" className={`flex flex-wrap items-center gap-3 rounded-2xl border p-4 ${status === 'required' ? 'border-blue-200 bg-blue-50' : 'border-amber-200 bg-amber-50'}`}>
    <ClipboardCheck className="h-6 w-6 shrink-0" aria-hidden="true" />
    <div className="min-w-0 flex-1"><h2 className="font-semibold">{status === 'required' ? 'Revisá y confirmá tus datos' : 'Datos firmados · completar aplicación'}</h2>
      <p className="mt-1 text-sm text-slate-600">{status === 'required' ? 'Revisá tu ficha y firmá la confirmación.' : 'Tu firma quedó guardada. Completá la aplicación en Mis datos.'}</p></div>
    <button type="button" onClick={onReview} className={`portal-button ${status === 'required' ? 'portal-button-primary' : ''}`}>{status === 'required' ? 'Revisar mis datos' : 'Ver mis datos'}</button>
  </aside>;
}

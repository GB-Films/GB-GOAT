import { useEffect, useState } from 'react';
import { portalRequest } from '../lib/providerPortal';
import { PrivateEvidenceField, type EvidenceFile } from './PrivateEvidenceField';
export const COMPANY_DOCUMENTS = { company_registration: 'Constitución, estatuto o registro de la empresa', representation_authority: 'Designación vigente o poder que acredite tus facultades', dni_front: 'Tu DNI · frente', dni_back: 'Tu DNI · dorso' };
export function CompanyRepresentationForm({ providerId, email, busy, onPrepare, request = portalRequest }: { providerId: string; email: string; busy: boolean; onPrepare: (input: any) => Promise<void>; request?: typeof portalRequest }) {
  const [company, setCompany] = useState({ name: '', cuit: '' });
  const [representative, setRepresentative] = useState({ name: '', dni: '', role: '' });
  const [files, setFiles] = useState<Record<string, EvidenceFile>>({});
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [pendingReview, setPendingReview] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { let active = true; request({ action: 'companyState', providerId }).then(result => {
    if (!active) return; setCompany(result.company); setPendingReview(result.pendingReview);
    setFiles(Object.fromEntries([...result.evidence].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).map((file: EvidenceFile) => [file.kind, file])));
  }).catch(error => { if (active) setError(error.message); }); return () => { active = false; }; }, [providerId, request]);
  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
    <div><h2 className="font-bold">Representación de la empresa</h2><p className="mt-2 text-sm">Vas a declarar que actuás por <strong>{company.name || 'esta empresa'}</strong>, CUIT <strong>{company.cuit || 'pendiente de completar por administración'}</strong>, con la cuenta <strong>{email}</strong>.</p>
      <p className="mt-2 text-sm text-slate-600">El alta y el correo no acreditan facultades para representar a una empresa. Necesitamos revisar tu identidad y el instrumento que te habilita a actuar y firmar por ella.</p></div>
    {error && <p role="alert" className="rounded bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {pendingReview ? <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Tu declaración firmada está pendiente de revisión de la documentación, la identidad y las facultades. Administración debe aprobarla para habilitar la representación.</p> : <form className="space-y-4" onSubmit={event => {
      event.preventDefault(); setError('');
      if (Object.keys(COMPANY_DOCUMENTS).some(kind => !files[kind])) { setError('Adjuntá los cuatro respaldos antes de preparar la declaración.'); return; }
      void onPrepare({ capacity: 'authorized_representative', representative, ...checks, evidenceIds: Object.keys(COMPANY_DOCUMENTS).map(kind => files[kind].id) });
    }}>
      <fieldset disabled={busy} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">{Object.entries({ name: 'Tu nombre y apellido', dni: 'Tu DNI', role: 'Cargo o carácter en que representás a la empresa' }).map(([key, label]) => <label key={key} className="text-sm">{label}<input required maxLength={key === 'dni' ? 12 : 160} inputMode={key === 'dni' ? 'numeric' : undefined} className="mt-1 block w-full rounded border p-2" value={representative[key]} onChange={event => setRepresentative(current => ({ ...current, [key]: event.target.value }))} /></label>)}</div>
        <div className="grid gap-3 sm:grid-cols-2">{Object.entries(COMPANY_DOCUMENTS).map(([kind, label]) => <div key={kind}><PrivateEvidenceField providerId={providerId} kind={kind} label={label} value={files[kind]} onChange={file => setFiles(current => ({ ...current, [kind]: file }))} disabled={busy} request={request} /></div>)}</div>
        <p className="text-xs text-slate-500">El poder o la designación debe mostrar las facultades vigentes y su alcance. Si figuran dentro del mismo instrumento societario, podés adjuntarlo también como respaldo de representación.</p>
        {Object.entries({ accountConfirmed: `Confirmo que controlo personalmente la cuenta ${email} y la utilizo para gestionar y representar a ${company.name || 'esta empresa'}.`, identityConfirmed: 'Confirmo que mi nombre y DNI son correctos y que los documentos adjuntos corresponden a mi identidad y a esta empresa.', authorityConfirmed: 'Declaro contar con facultades vigentes y suficientes para acceder a los datos y firmar por esta empresa los actos comprendidos en los documentos adjuntos. Informaré sus límites, cambios o revocaciones.' }).map(([key, label]) => <label key={key} className="flex items-start gap-2 text-sm"><input required type="checkbox" checked={!!checks[key]} onChange={event => setChecks(current => ({ ...current, [key]: event.target.checked }))} className="mt-1" /><span>{label}</span></label>)}
        <p className="text-sm text-slate-600">Después vas a revisar el PDF con estos datos y firmarlo. La firma deja constancia de tu declaración; la habilitación requiere aprobación de administración.</p>
        <button disabled={busy || !company.cuit} className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50">Revisar declaración de representación</button>
      </fieldset>
    </form>}
  </section>;
}

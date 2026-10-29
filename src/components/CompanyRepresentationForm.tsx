import { useEffect, useState } from 'react';
import { portalRequest } from '../lib/providerPortal';
import { PrivateEvidenceField, type EvidenceFile } from './PrivateEvidenceField';
export const COMPANY_DOCUMENTS = {
  representation_support: { label: 'Poder o respaldo de representación (opcional)', help: 'Si lo tenés, podés adjuntar un poder, designación o documento de representación. Podés continuar y firmar sin este archivo.', maxFiles: 6 },
  identity_document: { label: 'Tu DNI (obligatorio)', help: 'Ambas caras: un PDF o hasta dos archivos.', maxFiles: 2 },
};
export function CompanyRepresentationForm({ providerId, email, busy, onPrepare, request = portalRequest }: { providerId: string; email: string; busy: boolean; onPrepare: (input: any) => Promise<void>; request?: typeof portalRequest }) {
  const [company, setCompany] = useState({ name: '', cuit: '' });
  const [representative, setRepresentative] = useState({ name: '', dni: '', role: '' });
  const [files, setFiles] = useState<Record<string, EvidenceFile[]>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [pendingReview, setPendingReview] = useState(false);
  const [authority, setAuthority] = useState(false);
  const [error, setError] = useState('');
  const [uploads, setUploads] = useState<Record<string, boolean>>({});
  const uploading = Object.values(uploads).some(Boolean);
  useEffect(() => { let active = true; request({ action: 'companyState', providerId }).then(result => {
    if (!active) return; setCompany(result.company); setPendingReview(result.pendingReview); setAuthority(!!result.authority);
    setFiles(Object.fromEntries(Object.entries(COMPANY_DOCUMENTS).map(([kind, group]) => [kind, [...result.evidence].filter(file => file.kind === kind).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).slice(-group.maxFiles)])));
  }).catch(error => { if (active) setError(error.message); }); return () => { active = false; }; }, [providerId, request]);
  return <section id="company-representation-form" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
    <header><h2 className="font-bold">Representación de la empresa</h2><p className="mt-1 text-sm"><strong>{company.name || 'Empresa'}</strong> · CUIT {company.cuit || 'pendiente'}</p><p className="mt-1 break-all text-xs text-slate-500">Cuenta de representación: {email}</p></header>
    {error && <p role="alert" className="rounded bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    <p className="text-sm text-slate-600">Primero completá y firmá esta declaración con el correo con el que registraste la empresa. Al terminar se habilita tu representación en GOAT, sin esperar una revisión administrativa. Adjuntar un poder es opcional.</p>
    {authority && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-900">Tu representación ya está habilitada. Los contratos que te asignen aparecen en Documentos. Podés preparar otra declaración si necesitás actualizarla.</p>}
    {pendingReview && !authority && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Tenés una presentación del circuito anterior pendiente. Podés completar esta nueva declaración bajo tu responsabilidad; no hace falta esperar esa revisión.</p>}
    <form className="space-y-4" onSubmit={event => {
      event.preventDefault(); setError('');
      if (uploading) return;
      if (!files.identity_document?.length) { setError('Adjuntá tu DNI. El poder o respaldo de representación es opcional.'); return; }
      void onPrepare({ capacity: 'authorized_representative', representative, accountConfirmed: confirmed, identityConfirmed: confirmed, authorityConfirmed: confirmed, responsibilityConfirmed: confirmed, evidenceIds: Object.keys(COMPANY_DOCUMENTS).flatMap(kind => (files[kind] || []).map(file => file.id)) });
    }}>
      <fieldset disabled={busy} className="space-y-4">
        <div className="grid items-end gap-3 sm:grid-cols-3">{Object.entries({ name: 'Nombre y apellido', dni: 'DNI', role: 'Cargo o carácter' }).map(([key, label]) => <label key={key} className="flex min-w-0 flex-col gap-1 text-sm"><span>{label}</span><input required maxLength={key === 'dni' ? 12 : 160} inputMode={key === 'dni' ? 'numeric' : undefined} className="h-10 w-full rounded-lg border border-slate-300 px-3" value={representative[key]} onChange={event => setRepresentative(current => ({ ...current, [key]: event.target.value }))} /></label>)}</div>
        <div className="grid items-start gap-3 sm:grid-cols-2">{Object.entries(COMPANY_DOCUMENTS).map(([kind, group]) => <div key={kind}><PrivateEvidenceField providerId={providerId} kind={kind} {...group} values={files[kind] || []} onChange={next => setFiles(current => ({ ...current, [kind]: next }))} onUploadingChange={value => setUploads(current => ({ ...current, [kind]: value }))} disabled={busy} request={request} /></div>)}</div>
        <p className="text-xs text-slate-500">PDF, JPG o PNG · hasta 2 MB por archivo · acceso privado.</p>
        <label className="flex items-start gap-2 text-sm"><input required type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1" /><span>Declaro bajo mi responsabilidad que mi identidad es verídica, que controlo esta cuenta Google registrada y que tengo facultades vigentes y suficientes para representar legalmente a esta empresa y firmar contratos en su nombre. Me hago responsable de esta declaración y de informar cambios o revocaciones.</span></label>
        <div className="flex flex-wrap items-center gap-3"><button disabled={busy || uploading || !company.cuit || !confirmed} className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50">Revisar declaración y firmar</button><span className="text-xs text-slate-500">Al completar tu firma se habilita la representación.</span></div>
      </fieldset>
    </form>
  </section>;
}

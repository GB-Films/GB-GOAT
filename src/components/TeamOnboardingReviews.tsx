import { useEffect, useState } from 'react';
import { portalAdminRequest } from '../lib/providerPortal';

export default function TeamOnboardingReviews() {
  const [data, setData] = useState<any>({links:[],submissions:[]});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() { setData(await portalAdminRequest({action:'teamReviews'})); }
  useEffect(() => { void load().catch(e=>setError(e.message)); }, []);
  async function review(input: any) {
    setBusy(true);setError('');
    try { await portalAdminRequest(input);await load(); }
    catch(e:any) { setError(e.message); }
    finally { setBusy(false); }
  }
  if(!error && !data.links.length && !data.submissions.length) return null;
  return <section className="space-y-3 rounded-xl border bg-white p-5">
    <h2 className="font-bold">Altas de equipo para revisar</h2>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {data.links.map((r:any)=><div key={r.uid} className="space-y-2 rounded border p-3">
      <p className="font-semibold">{r.email}</p>
      {(r.projects || []).map((p:any)=><p key={p.id} className="text-sm">{p.name} · {p.role}</p>)}
      {!r.aclReviewed && <button disabled={busy} className="rounded border px-3 py-2" onClick={()=>void review({action:'reviewTeamAccess',uid:r.uid,confirmProjectAssignments:true})}>Confirmar que revisé sus permisos de proyecto</button>}
      <p className="text-sm">Vincular únicamente después de comprobar que la ficha corresponde a esta persona.</p>
      {r.candidates.map((p:any)=><button key={p.providerId} disabled={busy || p.type!=='persona'} className="mr-2 rounded border px-3 py-2" onClick={()=>void review({action:'resolveTeamProvider',uid:r.uid,providerId:p.providerId})}>Vincular {p.name || p.providerId}</button>)}
      {!r.candidates.length && <p className="text-sm">Sin coincidencia segura. La persona podrá volver a consultar su alta una vez revisados los permisos. Si hay una identidad fiscal duplicada, administración debe verificar la ficha existente.</p>}
    </div>)}
    {data.submissions.map((r:any)=><div key={r.id} className="space-y-2 rounded border p-3">
      <p className="font-semibold">{r.form.name} {r.form.lastName} · {r.email}</p>
      <p className="text-sm">CUIT: {r.form.cuit} · CBU/CVU: {r.form.bankAccount_cbu || '—'} · Alias: {r.form.bankAccount_alias || '—'}</p>
      <p className="text-sm">La ficha enviada habilita el trabajo; estos datos fiscales y bancarios siguen pendientes de aplicar.</p>
      <button disabled={busy} className="mr-2 rounded border px-3 py-2" onClick={()=>void review({action:'reviewTeamProfile',uid:r.uid,decision:'approved'})}>Aprobar datos enviados</button>
      <button disabled={busy} className="rounded border px-3 py-2" onClick={()=>void review({action:'reviewTeamProfile',uid:r.uid,decision:'rejected'})}>Rechazar datos enviados</button>
    </div>)}
  </section>;
}

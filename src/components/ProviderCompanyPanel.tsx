import { useEffect, useState } from 'react';
import { downloadPortalFile, portalAdminRequest } from '../lib/providerPortal';
export function ProviderCompanyPanel({ providerId }: { providerId: string }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => { let active = true; portalAdminRequest({ action: 'companyHistory', providerId }).then(result => { if (active) setData(result); }).catch(error => { if (active) setError(error.message); }); return () => { active = false; }; }, [providerId]);
  return <section className="space-y-3 text-sm">
    {error && <p role="alert" className="text-rose-700">{error}</p>}
    {!data ? <p>Cargando representación…</p> : <>
      <p>{data.approval ? `Representación revisada para ${data.approval.email}. Alcance: ${data.approval.scope}` : 'La empresa todavía no tiene una representación aprobada con el paquete actual de documentos.'}</p>
      {data.declarations.map((declaration: any) => <div key={declaration.id} className="rounded-lg border border-slate-200 p-3">
        <p className="font-medium">{declaration.content.representative?.name || declaration.content.profile?.name} · {declaration.actor.email}</p>
        <p className="mt-1 text-xs text-slate-500">{declaration.status === 'applied' ? declaration.review?.decision === 'approved' ? 'Revisada y aprobada' : 'Antecedente aplicado; requiere respaldo actualizado para nuevas firmas' : declaration.status === 'pending_review' ? 'Firmada, pendiente de revisión' : declaration.status === 'pending_signature' ? 'Pendiente de firma' : declaration.status}</p>
        <div className="mt-2 flex flex-wrap gap-2">{(declaration.content.evidence || []).map((file: any) => <button key={file.id} type="button" className="rounded border px-2 py-1 text-xs text-blue-700" onClick={async () => {
          try { downloadPortalFile(await portalAdminRequest({ action: 'evidenceFile', providerId, evidenceId: file.id })); } catch (error: any) { setError(error.message); }
        }}>{file.fileName}</button>)}</div>
      </div>)}
    </>}
  </section>;
}

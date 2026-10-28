import { useState } from 'react';
import { downloadPortalFile, portalRequest } from '../lib/providerPortal';
export type EvidenceFile = { id: string; kind: string; fileName: string; sha256: string; createdAt?: number };
export function PrivateEvidenceField({ providerId, kind, label, value, onChange, disabled = false, request = portalRequest }: {
  providerId: string; kind: string; label: string; value?: EvidenceFile; onChange: (file: EvidenceFile) => void; disabled?: boolean; request?: typeof portalRequest;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <div className="rounded-lg border border-slate-200 p-3">
    <label className="block text-sm font-medium">{label}<input type="file" accept="application/pdf,image/jpeg,image/png" disabled={disabled || busy}
      className="mt-2 block w-full text-xs" onChange={async event => {
        const file = event.target.files?.[0]; if (!file) return;
        setError(''); setBusy(true);
        try {
          if (!file.size || file.size > 2 * 1024 * 1024) throw Error('Usá un archivo de hasta 2 MB.');
          const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(Error('No pudimos leer el archivo.')); reader.readAsDataURL(file); });
          const uploaded = await request({ action: 'uploadEvidence', providerId, kind, attemptId: crypto.randomUUID(), file: { base64, fileName: file.name, contentType: file.type } });
          onChange(uploaded);
        } catch (error: any) { setError(error.message || 'No se pudo guardar el respaldo.'); } finally { setBusy(false); }
      }} /></label>
    <p className="mt-1 text-xs text-slate-500">PDF, JPG o PNG · hasta 2 MB · acceso privado para tu cuenta y administración.</p>
    {busy && <p role="status" className="mt-2 text-xs">Guardando respaldo…</p>}
    {value && <button type="button" className="mt-2 text-xs text-blue-700 underline" onClick={async () => {
      try { downloadPortalFile(await request({ action: 'evidenceFile', providerId, evidenceId: value.id })); }
      catch (error: any) { setError(error.message || 'No se pudo abrir el respaldo.'); }
    }}>{value.fileName} · ver respaldo guardado</button>}
    {error && <p role="alert" className="mt-2 text-xs text-rose-700">{error}</p>}
  </div>;
}

import { useState } from 'react';
import { downloadPortalFile, portalRequest } from '../lib/providerPortal';
export type EvidenceFile = { id: string; kind: string; fileName: string; sha256: string; createdAt?: number };
export function PrivateEvidenceField({ providerId, kind, label, help, values, maxFiles, onChange, onUploadingChange, disabled = false, request = portalRequest }: {
  providerId: string; kind: string; label: string; help: string; values: EvidenceFile[]; maxFiles: number;
  onChange: (files: EvidenceFile[]) => void; onUploadingChange?: (busy: boolean) => void; disabled?: boolean; request?: typeof portalRequest;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <div className="space-y-2 rounded-xl border border-slate-200 p-3">
    <label className="block text-sm font-medium">{label}<span className="mt-1 block text-xs font-normal text-slate-500">{help}</span>
      <input type="file" multiple accept="application/pdf,image/jpeg,image/png" disabled={disabled || busy || values.length >= maxFiles}
        className="mt-3 block w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-slate-700" onChange={async event => {
          const input = event.currentTarget as HTMLInputElement, files: File[] = Array.from(input.files || []); if (!files.length) return;
          setError('');
          if (values.length + files.length > maxFiles) { setError('Podés adjuntar hasta ' + maxFiles + ' archivos.'); input.value = ''; return; }
          if (files.some(file => !file.size || file.size > 2 * 1024 * 1024)) { setError('Usá archivos de hasta 2 MB.'); input.value = ''; return; }
          setBusy(true); onUploadingChange?.(true); const next = [...values];
          try {
            for (const file of files) {
              const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(Error('No pudimos leer el archivo.')); reader.readAsDataURL(file); });
              next.push(await request({ action: 'uploadEvidence', providerId, kind, attemptId: crypto.randomUUID(), file: { base64, fileName: file.name, contentType: file.type } }));
              onChange([...next]);
            }
          } catch (error: any) { setError(error.message || 'No se pudo guardar el respaldo.'); }
          finally { setBusy(false); onUploadingChange?.(false); input.value = ''; }
        }} /></label>
    {values.map(file => <div key={file.id} className="flex min-w-0 items-center gap-2 text-xs"><button type="button" className="min-w-0 flex-1 truncate text-left text-blue-700 hover:underline" onClick={async () => {
      try { downloadPortalFile(await request({ action: 'evidenceFile', providerId, evidenceId: file.id })); }
      catch (error: any) { setError(error.message || 'No se pudo abrir el respaldo.'); }
    }}>{file.fileName}</button><button type="button" disabled={disabled || busy} aria-label={'Quitar ' + file.fileName + ' de esta presentación'} className="shrink-0 rounded px-2 py-1 text-slate-500 hover:bg-slate-100" onClick={() => onChange(values.filter(value => value.id !== file.id))}>Quitar</button></div>)}
    {busy && <p role="status" className="text-xs text-slate-500">Guardando…</p>}
    {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
  </div>;
}

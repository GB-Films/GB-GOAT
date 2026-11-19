import { useState } from 'react';
import { downloadPortalFile, portalAdminRequest } from '../lib/providerPortal';

type PendingFile = { fileName: string; providerId: string; requestId: string; kind: string };
const kindLabels: Record<string, string> = { invoice: 'Factura', payment: 'Comprobante de pago', other: 'Otro comprobante' };

export function ProviderDownloadRequests({ busy, run, providerName }: {
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  providerName: (id: string) => string;
}) {
  const [files, setFiles] = useState<PendingFile[] | null>(null);
  const [reviewed, setReviewed] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');

  function resolveFile(requestId: string, publish: boolean) {
    const message = publish ? '¿Confirmás que el archivo completo corresponde a este proveedor y se puede compartir con su ficha?' : '¿Cerrar la solicitud sin habilitar este archivo?';
    if (!confirm(message)) return;
    void run(async () => {
      await portalAdminRequest({ requestId, ...(publish ? { action: 'approveFile', sha256: reviewed[requestId] } : { action: 'closeFileDownload' }) });
      setFiles(current => current?.filter(file => file.requestId !== requestId) || []);
      setNotice(publish ? 'La descarga quedó habilitada en Mi proveedor.' : 'Solicitud cerrada.');
    });
  }

  return <section className="rounded-2xl border bg-white p-4 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-semibold">Solicitudes de comprobantes</h2>
      <button type="button" disabled={busy} className="rounded border px-3 py-2 text-sm" onClick={() => run(async () => {
        setFiles((await portalAdminRequest({ action: 'pendingFileDownloads' })).files);
        setReviewed({});
        setNotice('');
      })}>{files ? 'Actualizar' : 'Ver solicitudes'}</button>
    </div>
    {notice && <p role="status" className="text-sm text-slate-600">{notice}</p>}
    {files?.map(file => <div key={file.requestId} className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm">
      <div><strong className="block">{providerName(file.providerId)}</strong>{file.fileName}<span className="ml-2 text-slate-500">{kindLabels[file.kind]}</span></div>
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={busy} className="underline" onClick={() => run(async () => {
          const original = await portalAdminRequest({ action: 'reviewFile', requestId: file.requestId });
          downloadPortalFile(original);
          setReviewed(current => ({ ...current, [file.requestId]: original.sha256 }));
        })}>Descargar para revisar</button>
        <button type="button" disabled={busy || !reviewed[file.requestId]} className="underline disabled:opacity-40" onClick={() => resolveFile(file.requestId, true)}>Habilitar descarga</button>
        <button type="button" disabled={busy} className="underline" onClick={() => resolveFile(file.requestId, false)}>Cerrar solicitud</button>
      </div>
    </div>)}
    {files && !files.length && <p className="text-sm text-slate-500">No hay solicitudes pendientes.</p>}
  </section>;
}

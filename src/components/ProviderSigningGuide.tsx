export function ProviderSigningGuide({ email, needsRepresentation, pendingCount, onDocuments }: {
  email: string; needsRepresentation: boolean; pendingCount: number; onDocuments: () => void;
}) {
  return <details className="portal-details mt-4 border-t border-slate-100 pt-4">
    <summary className="w-fit select-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">Cómo firmar tus documentos</summary>
    <div className="mt-4 space-y-3 rounded-xl bg-blue-50 p-4 text-slate-700">
    <p className="break-words text-sm">Usá tu cuenta Google registrada: <strong>{email}</strong>.</p>
    <ol className="list-decimal space-y-2 pl-5 text-sm">
      {needsRepresentation && <li>Completá la declaración de representación que aparece debajo: tus datos, DNI y responsabilidad por tus facultades. El poder es opcional. Revisá el PDF y firmá para habilitarte.</li>}
      <li>Entrá a <strong>Mi proveedor → Documentos</strong> y buscá el estado <strong>Pendiente de tu firma</strong>.</li>
      <li>Elegí <strong>Revisar y firmar</strong>. Leé el PDF, tocá tu recuadro de firma, confirmá tu DNI y dibujá tu firma o usá tu nombre.</li>
      <li>Aceptá la firma electrónica y pulsá <strong>Firmar y confirmar</strong>. Esperá la confirmación antes de cerrar.</li>
      <li>Cuando termine, podés descargar el <strong>PDF firmado</strong> y el <strong>Certificado de evidencia</strong>. Si faltan otras firmas, verás el estado en el documento.</li>
    </ol>
    <button type="button" className="portal-button portal-button-primary" onClick={onDocuments}>Ir a Documentos{pendingCount > 0 ? ` · ${pendingCount} por firmar` : ''}</button>
    </div>
  </details>;
}

export function ProviderSigningGuide({ email, needsRepresentation, pendingCount, onDocuments }: {
  email: string; needsRepresentation: boolean; pendingCount: number; onDocuments: () => void;
}) {
  return <aside className="space-y-3 rounded-2xl border border-blue-200 bg-blue-50 p-4" aria-label="Cómo firmar tus documentos">
    <h2 className="font-semibold">Cómo firmar tus documentos</h2>
    <p className="break-all text-sm">Ingresá siempre con tu cuenta Google registrada: <strong>{email}</strong>. Puede tener dominio propio; no necesita ser Gmail.</p>
    <ol className="list-decimal space-y-2 pl-5 text-sm">
      {needsRepresentation && <li>Completá la declaración de representación que aparece debajo: tus datos, DNI y responsabilidad por tus facultades. El poder es opcional. Revisá el PDF y firmá para habilitarte.</li>}
      <li>Cuando Gran Berta prepare tu contrato para firmar, aparecerá en <strong>Mi proveedor → Documentos</strong>, con su título y el estado <strong>Pendiente de tu firma</strong>.</li>
      <li>Elegí <strong>Revisar y firmar</strong>. Leé el PDF, tocá tu recuadro de firma, confirmá tu DNI y dibujá tu firma o usá tu nombre.</li>
      <li>Aceptá la firma electrónica y pulsá <strong>Firmar y confirmar</strong>. Esperá la confirmación antes de cerrar.</li>
      <li>Volvé a Documentos para ver el estado y descargar el <strong>PDF firmado</strong> y el <strong>Certificado de evidencia</strong>. Si firma más de una persona, se indicará cuando falten otras firmas.</li>
    </ol>
    <button type="button" className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white" onClick={onDocuments}>Ir a Documentos{pendingCount > 0 ? ` · ${pendingCount} por firmar` : ''}</button>
  </aside>;
}

import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProviderConfirmationNotice } from '../../src/components/ProviderConfirmationNotice';
import { ProviderProfileForm } from '../../src/components/ProviderProfileForm';
import '../../src/index.css';
const provider = { type: 'persona', name: 'Sofía', lastName: 'López', dni: '12345678', birthDate: '1991-04-12', cuit: '27123456789', address: 'Domicilio de ejemplo 123', phone: '1155555555', email: 'sofia@example.test', bankAccount_alias: 'sofia.cuenta.propia' };
const labels = { name: 'Nombre', lastName: 'Apellido', dni: 'DNI', birthDate: 'Fecha de nacimiento', cuit: 'CUIT', address: 'Domicilio', phone: 'Teléfono', email: 'Correo registrado', bankAccount_cbu: 'Tu CBU/CVU propio', bankAccount_alias: 'Tu alias propio' };
function Example() {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [review, setReview] = useState(false), [notice, setNotice] = useState('');
  return <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-8"><p className="text-xs text-slate-500">Vista de ejemplo · datos ficticios · no guarda datos ni firma documentos</p><h1 className="text-2xl font-bold">Mi proveedor</h1>
    <ProviderConfirmationNotice status="required" onReview={() => setReview(true)} />
    {review ? <ProviderProfileForm provider={provider} labels={labels} declarations={[]} draft={draft} onChange={setDraft} busy={false} confirmationRequired accessEmail={provider.email} notice={notice}
      onPrepare={async () => setNotice('En GOAT se abrirá el PDF con todos estos datos para revisarlo y firmarlo. Este ejemplo no registra una firma.')} /> : <section className="rounded-2xl border border-slate-200 bg-white p-4"><h2 className="font-semibold">Trabajos</h2><p className="mt-2 text-sm text-slate-600">Acá verás tus trabajos y documentos habituales.</p></section>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Example />);

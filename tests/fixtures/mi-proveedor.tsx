import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProviderProfileForm } from '../../src/components/ProviderProfileForm';
import '../../src/index.css';
const provider = { type: 'persona', name: 'Persona', lastName: 'Ejemplo', dni: '', cuit: '', email: 'persona@example.test', bankAccount_cbu: '', bankAccount_alias: '', address: 'Domicilio de ejemplo', phone: '1100000000' };
const declarations = [{ id: 'example', kind: 'profile', owned: true, status: 'pending_review', signedAt: '2026-10-28T12:00:00Z', content: { changes: {
  dni: { critical: true, after: '12345678' }, cuit: { critical: true, after: '20123456789' }, bankAccount_alias: { critical: true, after: 'persona.cuenta' },
} } }];
const labels = { name: 'Nombre', lastName: 'Apellido', dni: 'DNI', cuit: 'CUIT', address: 'Domicilio', phone: 'Teléfono', email: 'Correo de tu cuenta Google', bankAccount_cbu: 'Tu CBU/CVU propio', bankAccount_alias: 'Tu alias propio', bankAccount_holder: 'Titular' };
function Example() {
  const [draft, setDraft] = useState({}), [notice, setNotice] = useState('');
  return <main className="mx-auto max-w-5xl space-y-4 p-4 sm:p-8"><p className="text-xs text-slate-500">Ejemplo con datos ficticios · no guarda información ni firmas</p><ProviderProfileForm provider={provider} declarations={declarations} labels={labels} draft={draft} onChange={setDraft} busy={false} notice={notice} onPrepare={async () => setNotice('En GOAT se abre la ventana para revisar y firmar. Esta vista es de ejemplo.')} /><a className="inline-block text-sm text-blue-700 underline" href="./portal-signing.html?long&last">Probar firma con recuadro en la última página</a></main>;
}
createRoot(document.getElementById('root')!).render(<Example />);

import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CompanyRepresentationForm } from '../../src/components/CompanyRepresentationForm';
import { ThirdPartyAuthorizationForm } from '../../src/components/ThirdPartyAuthorizationForm';
import '../../src/index.css';

const demoRequest = async (input: Record<string, unknown>) => {
  if (input.action === 'companyState') return { company: { name: 'Empresa de ejemplo SRL', cuit: '30123456789' }, evidence: [], pendingReview: false };
  if (input.action === 'uploadEvidence') return { id: crypto.randomUUID(), kind: input.kind, fileName: (input.file as any).fileName, sha256: 'ejemplo' };
  throw Error('Vista de ejemplo: el archivo no se guarda ni se envía.');
};
function Example() {
  const [tab, setTab] = useState('tercero');
  const [notice, setNotice] = useState('');
  const [party, setParty] = useState<any>(() => { try { return { ...JSON.parse(sessionStorage.getItem('goat-third-party-example') || '{}'), workKeys: [], responsibilityConfirmed: false }; } catch { return { name: '', cuit: '', account: '', workKeys: [], responsibilityConfirmed: false }; } });
  return <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-8">
    <p className="text-xs text-slate-500">Vista de ejemplo · datos ficticios · no guarda documentos ni firmas</p>
    <h1 className="text-2xl font-bold">Mi proveedor · Mis datos</h1>
    <nav className="flex flex-wrap gap-2">{[['tercero', 'Quién factura y cobra por mí'], ['empresa', 'Representación de empresa']].map(([value, label]) => <button key={value} className={`rounded-lg border px-4 py-2 text-sm ${tab === value ? 'border-blue-200 bg-blue-50 text-blue-700' : 'bg-white'}`} onClick={() => { setTab(value); setNotice(''); }}>{label}</button>)}</nav>
    {notice && <p role="status" className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">{notice}</p>}
    {tab === 'tercero' ? <ThirdPartyAuthorizationForm provider={{ bankAccount_alias: 'sofia.cuenta.propia' }} works={[{ key: 'ejemplo/areaExpenses/sonido', projectName: 'Proyecto de ejemplo', description: 'Sonido durante rodaje' }]} party={party} onChange={setParty} busy={false}
      onSave={async input => { sessionStorage.setItem('goat-third-party-example', JSON.stringify({ name: input.name, cuit: input.cuit, account: input.cbu || input.alias })); }}
      onPrepare={async () => setNotice('En GOAT se abrirá el PDF con los datos y trabajos seleccionados. No tiene fecha de vencimiento y se puede revocar. Este ejemplo no registra una solicitud.')} /> : <CompanyRepresentationForm providerId="empresa-ejemplo" email="representante@example.test" request={demoRequest} busy={false} onPrepare={async () => setNotice('En GOAT vas a revisar y firmar la declaración de representación. Después administración revisa DNI, empresa y facultades antes de habilitarla. Este ejemplo no registra una solicitud.')} />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Example />);

import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProjectDocumentsView } from '../../src/pages/project-detail/ProjectDocumentsView';
import { ProjectDocumentUpload } from '../../src/pages/project-detail/ProjectDocumentUpload';
import { ProjectSigningPanel, type ProjectSigningDocument } from '../../src/pages/project-detail/ProjectSigningPanel';
import { signingDocumentMatchesProvider, type CatalogDocument, type DocumentCategory } from '../../src/lib/projectDocumentCatalog';
import '../../src/index.css';

const documents: CatalogDocument[] = [
  { id: 'invoice', family: 'finanzas', type: 'factura', providerName: 'Catering del Sur', fileName: 'Factura A 0001-00001234.pdf', description: 'Almuerzos del equipo · rodaje día 1', amount: 85000, url: '#', uploadedAt: '2026-10-25' },
  { id: 'payment', family: 'finanzas', type: 'Comprobante de pago', providerName: 'Catering del Sur', fileName: 'Transferencia — Catering del Sur.pdf', description: 'Pago de factura A 0001-00001234', amount: 85000, url: '#', paymentDate: '2026-10-27' },
  { id: 'withholding', family: 'finanzas', type: 'Retención', providerName: 'Servicios del Norte', fileName: 'Certificado de retención.pdf', description: 'Respaldo de retención', amount: 0, url: '#', uploadedAt: '2026-10-27' },
  { id: 'permission', family: 'locaciones', type: 'Permiso de filmación', providerName: 'Estudio Central', fileName: 'Permiso de filmación — Estudio Central.pdf', description: 'Uso del estudio durante el rodaje', amount: 0, url: '#', uploadedAt: '2026-10-24' },
  { id: 'insurance', family: 'seguros', type: 'Póliza / certificado', providerName: 'Aseguradora del Sur', fileName: 'Póliza de accidentes personales.pdf', description: 'Cobertura para el equipo de rodaje', amount: 0, url: '#', uploadedAt: '2026-10-26', expirationDate: '2026-11-30' },
];
const providers = [{ id: 'catering', businessName: 'Catering del Sur', adminEmail: 'catering@example.com' }, { id: 'talent', name: 'Sofía', lastName: 'López', email: 'sofia@example.com' }];
const contracts: ProjectSigningDocument[] = [
  { id: 'contract', title: 'Contrato de prestación de servicios · Catering del Sur', status: 'completed', artifactsReady: true, providerId: 'catering', signatures: [{ email: 'catering@example.com', status: 'signed' }] },
  { id: 'image', title: 'Cesión de imagen · Sofía López', status: 'pending', artifactsReady: false, providerId: 'talent', signatures: [{ email: 'sofia@example.com', status: 'pending' }] },
];

function Example() {
  const [category, setCategory] = useState<DocumentCategory>('comprobantes');
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState<'refresh' | null>(null);
  const [notice, setNotice] = useState('');
  return <main className="mx-auto max-w-[1440px] space-y-4 p-4 sm:p-8" onClick={event => {
    if ((event.target as HTMLElement).closest('a[href="#"]')) { event.preventDefault(); setNotice('Vista de ejemplo: no abre archivos reales.'); }
  }}>
    <p className="text-xs text-slate-500">Vista de ejemplo · datos ficticios · no modifica documentos ni conexiones</p>
    <h1 className="text-2xl font-bold">Proyecto de ejemplo</h1>
    {notice && <p role="status" className="rounded-lg bg-blue-50 p-3 text-sm text-blue-700">{notice}</p>}
    <ProjectDocumentsView documents={documents} category={category} onCategoryChange={setCategory} search={search} onSearchChange={setSearch} onUpload={() => setUploading(true)}
      signingSection={<ProjectSigningPanel state={{ connected: true, documents: contracts }} documents={contracts.filter(document => signingDocumentMatchesProvider(document, search, providers))}
        busy={busy} downloading="" error="" notice={busy === null && notice === 'Firmas actualizadas (ejemplo).' ? notice : ''}
        onOpen={() => setNotice('Vista de ejemplo: no abre ni modifica GB Sign.')}
        onRefresh={() => { setBusy('refresh'); setNotice(''); setTimeout(() => { setBusy(null); setNotice('Firmas actualizadas (ejemplo).'); }, 800); }}
        onDownload={() => setNotice('Vista de ejemplo: no descarga archivos reales.')} />} />
    {uploading && <ProjectDocumentUpload initialCategory={category} providers={documents.map(document => ({ id: document.id, label: document.providerName })).filter((provider, index, all) => all.findIndex(other => other.label === provider.label) === index)}
      areas={['Producción de Campo', 'Arte', 'Post Producción']} busy={false} onClose={() => setUploading(false)}
      onSubmit={event => { event.preventDefault(); setUploading(false); setNotice('Vista de ejemplo: no se subió ningún documento.'); }} />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Example />);

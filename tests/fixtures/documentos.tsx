import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { ProjectDocumentsView } from '../../src/pages/project-detail/ProjectDocumentsView';
import { ProjectDocumentUpload } from '../../src/pages/project-detail/ProjectDocumentUpload';
import { ProjectSigningPanel, type ProjectSigningDocument } from '../../src/pages/project-detail/ProjectSigningPanel';
import { type CatalogDocument, type DocumentCategory } from '../../src/lib/projectDocumentCatalog';
import { ProjectContractEditor } from '../../src/pages/project-detail/ProjectContractEditor';
import { contractSamplePdf } from './contract-pdf';
import '../../src/index.css';

const documents: CatalogDocument[] = [
  { id: 'invoice', family: 'finanzas', type: 'factura', providerName: 'Catering del Sur', fileName: 'Factura A 0001-00001234.pdf', description: 'Almuerzos del equipo · rodaje día 1', amount: 85000, url: '#', uploadedAt: '2026-10-25' },
  { id: 'payment', family: 'finanzas', type: 'Comprobante de pago', providerName: 'Catering del Sur', fileName: 'Transferencia — Catering del Sur.pdf', description: 'Pago de factura A 0001-00001234', amount: 85000, url: '#', paymentDate: '2026-10-27' },
  { id: 'withholding', family: 'finanzas', type: 'Retención', providerName: 'Servicios del Norte', fileName: 'Certificado de retención.pdf', description: 'Respaldo de retención', amount: 0, url: '#', uploadedAt: '2026-10-27' },
  { id: 'permission', sourceDocumentId: 'permission', contentType: 'application/pdf', family: 'locaciones', type: 'Permiso de filmación', providerName: 'Estudio Central', fileName: 'Permiso de filmación — Estudio Central.pdf', description: 'Uso del estudio durante el rodaje', amount: 0, url: '#', uploadedAt: '2026-10-24' },
  { id: 'insurance', family: 'seguros', type: 'Póliza / certificado', providerName: 'Aseguradora del Sur', fileName: 'Póliza de accidentes personales.pdf', description: 'Cobertura para el equipo de rodaje', amount: 0, url: '#', uploadedAt: '2026-10-26', expirationDate: '2026-11-30' },
];
const providers = [{ id: 'catering', businessName: 'Catering del Sur', adminEmail: 'catering@example.com' }, { id: 'talent', name: 'Sofía', lastName: 'López', email: 'sofia@example.com' }];
const initialContracts: ProjectSigningDocument[] = [
  { id: 'contract', title: 'Contrato de prestación de servicios · Catering del Sur', status: 'completed', artifactsReady: true, providerId: 'catering', signatures: [{ email: 'catering@example.com', status: 'signed' }] },
  { id: 'image', title: 'Cesión de imagen · Sofía López', status: 'pending', artifactsReady: false, providerId: 'talent', signatures: [{ email: 'sofia@example.com', status: 'pending' }] },
];

function Example() {
  const [category, setCategory] = useState<DocumentCategory>('contratos');
  const [drafts, setDrafts] = useState<CatalogDocument[]>([...documents, { id: 'local-draft', sourceDocumentId: 'draft', providerId: 'talent', contentType: 'application/pdf', family: 'contratos', providerName: 'Sofía López', fileName: 'cesion-de-imagen-para-preparar.pdf', description: 'Cesión de imagen · lista para preparar', url: '#', amount: 0 }]);
  const [contracts, setContracts] = useState(initialContracts);
  const [editing, setEditing] = useState<CatalogDocument | null>(null);
  const [sampleUrl, setSampleUrl] = useState('');
  const localFiles = useRef(new Map<string, string>());
  useEffect(() => { const url = URL.createObjectURL(contractSamplePdf()); setSampleUrl(url); return () => { URL.revokeObjectURL(url); for (const file of localFiles.current.values()) URL.revokeObjectURL(file); }; }, []);
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
    <ProjectDocumentsView documents={drafts} category={category} onCategoryChange={setCategory} search={search} onSearchChange={setSearch} onUpload={() => setUploading(true)}
      signingSection={<ProjectSigningPanel state={{ connected: true, documents: contracts }} documents={contracts} manualDocuments={drafts} search={search} providers={providers} onPrepare={setEditing}
        busy={busy} downloading="" error="" notice={busy === null && notice === 'Firmas actualizadas (ejemplo).' ? notice : ''}
        onRefresh={() => { setBusy('refresh'); setNotice(''); setTimeout(() => { setBusy(null); setNotice('Firmas actualizadas (ejemplo).'); }, 800); }}
        onDownload={() => setNotice('Vista de ejemplo: no descarga archivos reales.')} />} />
    {uploading && <ProjectDocumentUpload initialCategory={category} providers={[{ id: 'talent', label: 'Sofía López' }, { id: 'catering', label: 'Catering del Sur' }]}
      areas={['Producción de Campo', 'Arte', 'Post Producción']} busy={false} onClose={() => setUploading(false)}
      onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); const file = data.get('file') as File; const id = crypto.randomUUID(); if (file?.size) { localFiles.current.set(id, URL.createObjectURL(file)); const supplier = data.get('providerId'); setDrafts(current => [...current, { id: `local-${id}`, sourceDocumentId: id, family: String(data.get('family')), contentType: file.type, fileName: file.name, description: String(data.get('title') || file.name), providerId: String(supplier || ''), providerName: supplier === 'talent' ? 'Sofía López' : supplier === 'catering' ? 'Catering del Sur' : 'Sin proveedor', url: localFiles.current.get(id)!, amount: 0 }]); } setUploading(false); setNotice('Archivo agregado sólo a este ejemplo local.'); }} />}
    {editing && <ProjectContractEditor title={editing.description || editing.fileName} url={localFiles.current.get(editing.sourceDocumentId!) || sampleUrl}
      initialProviderId={editing.providerId} providers={[{ providerId: 'talent', name: 'Sofía López', email: 'sofia@example.com', dni: '12345678' }, { providerId: 'catering', name: 'Catering del Sur', email: 'catering@example.com' }]}
      onRetry={() => {}} onClose={() => setEditing(null)} onSubmit={async (providerIds, fields) => {
        setContracts(current => [...current, { id: `prepared-${editing.sourceDocumentId}`, source: 'sign_project', sourceDocumentId: editing.sourceDocumentId, title: editing.description || editing.fileName, status: 'pending',
          providerBindings: providerIds.map(providerId => ({ providerId, name: providerId === 'talent' ? 'Sofía López' : 'Catering del Sur', email: providerId === 'talent' ? 'sofia@example.com' : 'catering@example.com' })), signatures: fields.map(field => ({ email: field.signerEmail, status: 'pending' })) }]);
        setEditing(null); setNotice('Solicitud simulada en el ejemplo. No se enviaron contratos ni solicitudes reales.');
      }} />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Example />);

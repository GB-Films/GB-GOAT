import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProjectProvidersView, type ProjectProviderBalance } from '../../src/pages/project-detail/ProjectProvidersView';
import { filterProviderBalances, type ProviderPaymentStatus } from '../../src/lib/providerPaymentStatus';
import { DEFAULT_RESULT_INCIDENCES } from '../../src/lib/resultIncidences';
import { ProviderDetailView } from '../../src/components/ProviderDetailView';
import { ProviderFinancialRecordList } from '../../src/components/ProviderFinancialRecordList';
import { financialDocumentsForExpense } from '../../src/lib/providerFinancialRecords';
import '../../src/index.css';

const rows: ProjectProviderBalance[] = [
  { id: 'catering', name: 'Catering del Sur', paid: 85000, spent: 85000, debt: 0 },
  { id: 'sofia', name: 'Sofía López', paid: 100000, spent: 250000, debt: 150000 },
  { id: 'estudio', name: 'Estudio Central', paid: 0, spent: 180000, debt: 180000 },
].map(row => ({ ...row, area: 'Producción de Campo', budgeted: row.spent, cuit: '30123456789', cbu: '0000000000000000000000',
  provider: { id: row.id, type: 'empresa', businessName: row.name, email: `${row.id}@example.com`, phone: '11 0000-0000', address: 'Domicilio de ejemplo', cuit: '30123456789', bankAccount_cbu: '0000000000000000000000', category: 'Servicios' },
  entries: [{ id: `expense-${row.id}`, collectionName: 'areaExpenses', description: row.id === 'catering' ? 'Almuerzos para el equipo' : row.id === 'sofia' ? 'Servicio durante rodaje' : 'Alquiler del estudio', total: row.spent, paid: row.paid,
    invoices: [{ url: '#factura', fileName: `Factura-${row.id}.pdf` }], item: { paymentDate: '2026-10-29', paymentHistory: row.paid ? [{ amount: row.paid, receipt: { url: '#comprobante', originalFileName: `Pago-${row.id}.pdf` } }] : [] } }],
}));
const groups = [{ area: 'Producción de Campo', rows }];
function detailFor(provider: any) {
  const row = rows.find(row => row.provider.id === provider.id)!;
  const lines = [0, 1, 2, 3].map(index => ({ id: `${provider.id}-${index}`, expenseId: `${provider.id}-${index}`, collectionName: 'areaExpenses', projectId: index < 2 ? 'project-one' : index === 2 ? 'project-two' : 'project-three', projectName: index < 2 ? 'Proyecto de ejemplo' : index === 2 ? 'Otro proyecto' : 'Tercer proyecto',
    area: row.area, source: 'Gestión por Áreas', description: index === 0 ? row.entries[0].description : index === 1 ? 'Servicio adicional' : 'Servicio en otro proyecto',
    total: index < 2 ? row.spent / 2 : 30000, paid: index < 2 ? row.paid / 2 : 0, debt: index < 2 ? row.debt / 2 : 30000,
    payments: index < 2 && row.paid ? [{ id: `payment-${index}`, amount: row.paid / 2, date: '2026-10-27', loadedBy: 'Administración' }] : [],
    invoiceDocuments: [], paymentReceiptDocuments: [], sharedDocuments: [],
  }));
  const allocations = lines.map(line => ({ projectId: line.projectId, projectName: line.projectName, collectionName: line.collectionName, itemId: line.expenseId, description: line.description, amountCents: Math.round(line.total * 100) }));
  const records = [{ id: 'shared-invoice', kind: 'invoice', number: 'C 00001-00000098', date: '2026-10-15', issuerName: provider.businessName, issuerCuit: '30123456789', currency: 'ARS', totalCents: (row.spent + 60000) * 100, netArsCents: (row.spent + 60000) * 100, status: 'active', file: { fileName: 'Factura-compartida.pdf' }, notes: 'Ejemplo de una única factura aplicada a tres proyectos. Las notas extensas se consultan sólo al abrir este detalle.', allocations },
    ...(row.paid ? [{ id: 'shared-payment', kind: 'payment', date: '2026-10-21', payeeName: provider.businessName, currency: 'ARS', totalCents: row.paid * 100, netArsCents: row.paid * 100, status: 'active', file: { fileName: 'Transferencia.pdf' }, notes: 'Comprobante de ejemplo.', allocations: allocations.slice(0, 2).map(allocation => ({ ...allocation, amountCents: row.paid * 50 })) }] : [])];
  lines.forEach(line => { line.sharedDocuments = financialDocumentsForExpense(records, line); });
  const projects = ['project-one', 'project-two', 'project-three'].map(id => { const selected = lines.filter(line => line.projectId === id); return { id, name: selected[0].projectName,
    total: selected.reduce((sum, line) => sum + line.total, 0), paid: selected.reduce((sum, line) => sum + line.paid, 0), debt: selected.reduce((sum, line) => sum + line.debt, 0), invoices: selected.length, receipts: 0 }; });
  return { provider, lines, projects, records, totals: { total: row.spent + 60000, paid: row.paid, debt: row.debt + 60000 } };
}
function ExampleAssignments({ detail }: { detail: ReturnType<typeof detailFor> }) {
  const [kind, setKind] = useState('');
  const [notice, setNotice] = useState('');
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm text-slate-500">{detail.provider.businessName}</h3><div className="flex gap-2">{['Factura', 'Pago', 'Comprobante'].map(value => <button type="button" key={value} onClick={() => setKind(kind === value ? '' : value)} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${value === 'Factura' ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 text-slate-700'}`}>+ {value}</button>)}</div></div>
    {notice && <p role="status" className="rounded-lg bg-blue-50 p-3 text-xs text-blue-700">{notice}</p>}
    {kind && <section className="space-y-3 rounded-lg border p-3"><h3 className="text-sm font-semibold">{kind} · ejemplo</h3>
    <label className="block text-sm">Archivo<input type="file" className="mt-2 block w-full rounded border p-2 text-xs" /></label>
    <h3 className="text-sm font-semibold">Aplicar a movimientos</h3><div className="divide-y rounded-lg border">{detail.lines.map(line => <label key={line.id} className="flex items-center gap-3 p-3 text-xs"><input type="checkbox" /><span className="flex-1">{line.projectName} · {line.description}</span><span>${line.total.toLocaleString('es-AR')}</span></label>)}</div>
    <button type="button" onClick={() => { setKind(''); setNotice('Vista de ejemplo: no se guardaron cambios.'); }} className="rounded bg-slate-900 px-4 py-2 text-sm text-white">Guardar y aplicar · ejemplo</button></section>}
    <ProviderFinancialRecordList records={detail.records} onOpen={async () => setNotice('Archivo de ejemplo: en GOAT se abre el original compartido.')} onCancel={async () => setNotice('Vista de ejemplo: no se anuló ningún registro.')} />
  </div>;
}
function Example() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ProviderPaymentStatus | 'all'>('all');
  const [tab, setTab] = useState('Proveedores');
  const [notice, setNotice] = useState('');
  const [providerDetail, setProviderDetail] = useState<ReturnType<typeof detailFor> | null>(() => new URLSearchParams(location.search).has('ficha') ? detailFor(rows[0].provider) : null);
  return <main className="mx-auto max-w-[1600px] space-y-4 p-4 sm:p-8" onClick={event => {
    if ((event.target as HTMLElement).closest('a[href^="#"]')) { event.preventDefault(); setNotice('Ejemplo: los archivos son ficticios.'); }
  }}>
    <p className="text-xs text-slate-500">Vista de ejemplo · datos ficticios · no modifica proveedores ni pagos</p>
    <h1 className="text-2xl font-bold">Proyecto de ejemplo</h1>
    <nav className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-slate-100 p-2">{['Resumen', 'Presu Ppal', 'Áreas', 'Cajas', 'Finanzas', 'Administración', 'Documentos', 'Resultado', 'Proveedores', 'Permisos'].map(label => <button key={label} type="button" onClick={() => setTab(label)} className={`rounded-lg border px-3 py-2 text-sm ${tab === label ? 'border-blue-200 bg-white text-blue-600' : 'border-transparent text-slate-600'}`}>{label}</button>)}</nav>
    {notice && <p role="status" className="rounded-lg bg-blue-50 p-3 text-sm text-blue-700">{notice}</p>}
    {tab === 'Proveedores' ? <ProjectProvidersView groups={filterProviderBalances(groups, search, status)} totalRows={rows.length} search={search} onSearchChange={setSearch} status={status} onStatusChange={setStatus}
      isProjectAdmin={true} canManagePaymentForItem={() => true} openPaymentModal={item => setNotice(item.paymentHistory.length ? 'Ejemplo: aquí se abre el historial de pagos.' : 'Ejemplo: aquí se registra un pago.')} formatDate={date => String(date).split('-').reverse().join('/')} paymentTiming={() => 'Fecha programada'} onOpenProvider={provider => setProviderDetail(detailFor(provider))} />
      : tab === 'Resultado' ? <section className="max-w-xl rounded-xl border border-slate-200 bg-white p-4"><h2 className="mb-3 font-bold">Incidencias sobre valor de venta</h2>{Object.entries(DEFAULT_RESULT_INCIDENCES).map(([id, value]) => <label key={id} className="flex items-center justify-between border-t border-slate-100 py-3 text-sm capitalize">{id === 'administracion' ? 'Indirectos' : id}<span>{value}%</span></label>)}</section>
      : <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Vista de ejemplo enfocada en Proveedores y porcentajes de Resultado.</p>}
    {providerDetail && <ProviderDetailView detail={providerDetail} loading={false} initialProjectId="project-one" onOpenSharedDocument={async () => { setNotice('Archivo de ejemplo: en GOAT se abre el original compartido.'); window.alert('Vista de ejemplo: este botón abre la misma factura original desde cada proyecto.'); }} onClose={() => setProviderDetail(null)} financePanel={<ExampleAssignments detail={providerDetail} />} />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Example />);

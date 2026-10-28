import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProjectProvidersView, type ProjectProviderBalance } from '../../src/pages/project-detail/ProjectProvidersView';
import { filterProviderBalances, type ProviderPaymentStatus } from '../../src/lib/providerPaymentStatus';
import { DEFAULT_RESULT_INCIDENCES } from '../../src/lib/resultIncidences';
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
function Example() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ProviderPaymentStatus | 'all'>('all');
  const [tab, setTab] = useState('Proveedores');
  const [notice, setNotice] = useState('');
  return <main className="mx-auto max-w-[1600px] space-y-4 p-4 sm:p-8" onClick={event => {
    if ((event.target as HTMLElement).closest('a[href^="#"]')) { event.preventDefault(); setNotice('Ejemplo: los archivos son ficticios.'); }
  }}>
    <p className="text-xs text-slate-500">Vista de ejemplo · datos ficticios · no modifica proveedores ni pagos</p>
    <h1 className="text-2xl font-bold">Proyecto de ejemplo</h1>
    <nav className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-slate-100 p-2">{['Resumen', 'Presu Ppal', 'Áreas', 'Cajas', 'Finanzas', 'Administración', 'Documentos', 'Resultado', 'Proveedores', 'Permisos'].map(label => <button key={label} type="button" onClick={() => setTab(label)} className={`rounded-lg border px-3 py-2 text-sm ${tab === label ? 'border-blue-200 bg-white text-blue-600' : 'border-transparent text-slate-600'}`}>{label}</button>)}</nav>
    {notice && <p role="status" className="rounded-lg bg-blue-50 p-3 text-sm text-blue-700">{notice}</p>}
    {tab === 'Proveedores' ? <ProjectProvidersView groups={filterProviderBalances(groups, search, status)} totalRows={rows.length} search={search} onSearchChange={setSearch} status={status} onStatusChange={setStatus}
      isProjectAdmin={true} canManagePaymentForItem={() => true} openPaymentModal={item => setNotice(item.paymentHistory.length ? 'Ejemplo: aquí se abre el historial de pagos.' : 'Ejemplo: aquí se registra un pago.')} formatDate={date => String(date).split('-').reverse().join('/')} paymentTiming={() => 'Fecha programada'} />
      : tab === 'Resultado' ? <section className="max-w-xl rounded-xl border border-slate-200 bg-white p-4"><h2 className="mb-3 font-bold">Incidencias sobre valor de venta</h2>{Object.entries(DEFAULT_RESULT_INCIDENCES).map(([id, value]) => <label key={id} className="flex items-center justify-between border-t border-slate-100 py-3 text-sm capitalize">{id === 'administracion' ? 'Indirectos' : id}<span>{value}%</span></label>)}</section>
      : <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Vista de ejemplo enfocada en Proveedores y porcentajes de Resultado.</p>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Example />);

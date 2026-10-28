import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Download } from 'lucide-react';
import { ProviderDataExportDialog } from '../../src/components/ProviderDataExportDialog';
import { providerDisplayName } from '../../src/lib/providerConstants';
import { exportExampleProviders } from './provider-export-data';
import '../../src/index.css';
function Example() {
  const [open, setOpen] = useState(true);
  return <main className="mx-auto max-w-6xl space-y-5 p-6 sm:p-10"><p className="text-xs text-slate-500">Vista de ejemplo · datos ficticios · no modifica proveedores</p>
    <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold">Proveedores</h1><button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white"><Download className="h-4 w-4"/>Exportar datos</button></header>
    <section className="divide-y rounded-xl border border-slate-200 bg-white">{exportExampleProviders.map(provider => <div key={provider.id} className="px-4 py-3 text-sm">{providerDisplayName(provider)}</div>)}</section>
    {open && <ProviderDataExportDialog providers={exportExampleProviders} onClose={() => setOpen(false)} onExport={async selected => { const { downloadProviderData } = await import('../../src/lib/providerDataWorkbook'); await downloadProviderData(selected); }}/>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Example/>);

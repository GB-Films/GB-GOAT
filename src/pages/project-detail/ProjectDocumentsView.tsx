import type { ReactNode } from 'react';
import { FileText, FileSignature, ShieldCheck, Search, Upload, ExternalLink, X } from 'lucide-react';
import { DOCUMENT_CATEGORIES, filterProjectDocuments, type CatalogDocument, type DocumentCategory } from '../../lib/projectDocumentCatalog';
import { cashMovementDate } from '../../lib/cashLedgerView';
import { cn } from '../../lib/utils';

const icons = { comprobantes: FileText, contratos: FileSignature, seguros: ShieldCheck };

export function ProjectDocumentsView({ documents, category, onCategoryChange, search, onSearchChange, onUpload, signingSection }: {
  documents: CatalogDocument[]; category: DocumentCategory; onCategoryChange: (category: DocumentCategory) => void;
  search: string; onSearchChange: (search: string) => void; onUpload?: () => void; signingSection?: ReactNode;
}) {
  const filtered = filterProjectDocuments(documents, category, search);
  return <section className="space-y-4 pb-12">
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <h2 className="text-base font-bold text-slate-900">Documentos</h2>
      {onUpload && <button type="button" onClick={onUpload}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700">
        <Upload className="h-4 w-4" />{category === 'contratos' ? 'Cargar contrato' : 'Subir documento'}
      </button>}
    </header>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="Categorías de documentos" className="flex flex-wrap gap-2">
        {DOCUMENT_CATEGORIES.map(item => {
          const Icon = icons[item.id];
          return <button key={item.id} type="button" aria-pressed={category === item.id} onClick={() => onCategoryChange(item.id)}
            className={cn('inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-blue-500',
              category === item.id ? 'border-blue-200 bg-blue-50 text-blue-700 shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}>
            <Icon className="h-4 w-4" />{item.label}
          </button>;
        })}
      </nav>
      <div className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 focus-within:border-blue-400 sm:w-72">
        <Search className="h-4 w-4 shrink-0 text-slate-400" />
        <label htmlFor="document-provider-search" className="sr-only">Buscar por proveedor</label>
        <input id="document-provider-search" value={search} onChange={event => onSearchChange(event.target.value)} placeholder="Buscar proveedor"
          className="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none placeholder:text-slate-400" />
        {search && <button type="button" onClick={() => onSearchChange('')} aria-label="Limpiar búsqueda" className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>}
      </div>
    </div>
    {category === 'contratos' && signingSection}
    {(category !== 'contratos' || !signingSection) && <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500"><tr>
          {['Documento', 'Proveedor', 'Fecha', 'Monto', ''].map(label => <th key={label} scope="col" className={cn('px-4 py-3 font-medium', (label === 'Monto' || !label) && 'text-right')}>{label || <span className="sr-only">Archivo</span>}</th>)}
        </tr></thead>
        <tbody className="divide-y divide-slate-100">{filtered.map(document => <tr key={document.id} className="align-middle hover:bg-slate-50/50">
          <td className="min-w-56 px-4 py-2.5">
            <div className="flex max-w-lg items-center gap-2">
              <span title={document.type} className="max-w-40 shrink-0 truncate rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{document.type === 'factura' ? 'Factura' : document.type === 'comprobante' ? 'Comprobante' : document.type || 'Documento'}</span>
              <p title={[document.fileName, document.description].filter(Boolean).join(' · ')} className="min-w-0 truncate font-semibold text-slate-900">{document.fileName}</p>
            </div>
            {document.expirationDate && <p className="mt-1 text-xs text-slate-500">Vence {cashMovementDate(document.expirationDate)?.toLocaleDateString('es-AR') || document.expirationDate}</p>}
          </td>
          <td className="px-4 py-2.5 font-medium text-slate-700">{document.providerName}</td>
          <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">{(cashMovementDate(document.paymentDate) || cashMovementDate(document.uploadedAt))?.toLocaleDateString('es-AR') || '—'}</td>
          <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-slate-700">{document.amount > 0 ? `$${document.amount.toLocaleString('es-AR')}` : '—'}</td>
          <td className="px-4 py-2.5 text-right">{document.url ? <a href={document.url} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100">Abrir<ExternalLink className="h-3.5 w-3.5" /></a>
            : <span className="text-xs text-slate-400">Sin archivo</span>}</td>
        </tr>)}</tbody>
      </table>
      {filtered.length === 0 && <p className="p-10 text-center text-sm text-slate-500">{search ? 'No hay documentos de este proveedor en esta categoría.' : 'Todavía no hay documentos en esta categoría.'}</p>}
    </div>}
  </section>;
}

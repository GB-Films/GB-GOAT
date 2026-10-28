import { useState } from 'react';
import { ArrowDownLeft, ChevronRight, FileText, Paperclip, Download, Ban, Search } from 'lucide-react';
import { financialRecordProjects, filterFinancialRecords } from '../lib/providerFinancialRecords';

const money = (cents: number, currency = 'ARS') => `${currency === 'ARS' ? '$' : `${currency} `}${((Number(cents) || 0) / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (value: string) => value?.split('-').reverse().join('/') || 'Sin fecha';
type Props = { records: any[]; busy?: boolean; onOpen: (id: string) => Promise<unknown>; onCancel: (record: any) => Promise<unknown> };

export function ProviderFinancialRecordList({ records, busy, onOpen, onCancel }: Props) {
  const [opening, setOpening] = useState('');
  const [error, setError] = useState('');
  const [kind, setKind] = useState('all');
  const [projectSearch, setProjectSearch] = useState('');
  const card = (record: any) => {
    const invoice = record.kind === 'invoice', payment = record.kind === 'payment';
    const Icon = invoice ? FileText : payment ? ArrowDownLeft : Paperclip;
    const projects = financialRecordProjects(record.allocations);
    const cancelled = record.status === 'cancelled';
    return <article key={record.id} className={`overflow-hidden rounded-xl border border-slate-200 bg-white ${cancelled ? 'opacity-60' : ''}`} aria-label={`${invoice ? 'Factura' : payment ? 'Pago' : 'Comprobante'} ${record.number || date(record.date)}`}>
      <header className="flex flex-wrap items-center gap-3 p-3">
        <span className={`rounded-lg p-2 ${invoice ? 'bg-blue-50 text-blue-600' : payment ? 'bg-violet-50 text-violet-600' : 'bg-slate-100 text-slate-600'}`}><Icon className="h-5 w-5" aria-hidden="true"/></span>
        <div className="min-w-0 flex-1"><h4 className="break-words text-sm font-semibold text-slate-900">{invoice ? `Factura ${record.number || (record.documentOnly ? `· ${record.file?.fileName || ''}` : '')}` : payment ? 'Pago' : `Comprobante${record.documentOnly ? ` · ${record.file?.fileName || ''}` : ''}`}{cancelled && <span className="ml-2 text-xs font-normal text-rose-700">Anulado</span>}</h4>
          <p className="mt-0.5 text-xs text-slate-500">{record.documentOnly && 'Cargado el '}{date(record.date)}{(invoice ? record.issuerName : record.payeeName) && <> · {invoice ? record.issuerName : record.payeeName}</>}</p>
        </div>
        {!record.documentOnly && <strong className="text-sm tabular-nums text-slate-900">{money(record.totalCents, record.currency)}</strong>}
        {record.file && <button type="button" disabled={!!opening || busy} onClick={async () => { setOpening(record.id); setError(''); try { await onOpen(record.id); } catch { setError('No se pudo abrir el archivo. Volvé a intentar.'); } finally { setOpening(''); } }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50"><Download className="h-3.5 w-3.5"/>{opening === record.id ? 'Abriendo…' : 'Abrir archivo'}</button>}
      </header>
      {projects.length > 0 && <div className="border-t border-slate-100 bg-slate-50/70">
        <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Proyectos incluidos</div>
        <ul className="divide-y divide-slate-100">{projects.map(project => <li key={project.id} className="flex items-center justify-between gap-4 px-3 py-2 text-xs">
          <a href={`#/proyectos/${project.id}`} title={project.descriptions.join(' · ')} className="inline-flex min-w-0 items-center gap-1 text-slate-700 hover:text-blue-700 hover:underline"><ChevronRight className="h-3 w-3 shrink-0 text-slate-400"/><span>{project.name}</span></a>
          <span className="shrink-0 font-medium tabular-nums text-slate-700">{money(project.amountCents)}</span>
        </li>)}</ul>
        {record.kind !== 'other' && <div className="flex items-center justify-between gap-3 border-t border-slate-200/70 px-3 py-2 text-xs font-semibold text-slate-600"><span>Total aplicado</span><span className="tabular-nums">{money(record.netArsCents)}</span></div>}
      </div>}
      <details className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
        <summary className="w-fit cursor-pointer hover:text-slate-900">Detalle</summary>
        <div className="mt-2 space-y-2 pb-1">
          {record.issuerCuit && <p>CUIT del emisor: {record.issuerCuit}</p>}
          {record.payeeCuit && <p>CUIT del destinatario: {record.payeeCuit}</p>}
          {record.notes && <p className="whitespace-pre-wrap break-words leading-relaxed">{record.notes}</p>}
          {projects.map(project => project.descriptions.length > 0 && <p key={project.id}><b>{project.name}:</b> {project.descriptions.join(' · ')}</p>)}
          {record.status === 'active' && <button type="button" disabled={busy || !!opening} className="inline-flex items-center gap-1 rounded px-2 py-1 text-rose-700 hover:bg-rose-50 disabled:opacity-50" onClick={async () => { setError(''); try { await onCancel(record); } catch { setError('No se pudo anular el registro.'); } }}><Ban className="h-3 w-3"/>Anular {invoice ? 'factura' : payment ? 'pago' : 'comprobante'}</button>}
        </div>
      </details>
    </article>;
  };
  const filtered = filterFinancialRecords(records, kind, projectSearch);
  const active = filtered.filter(record => record.status !== 'cancelled');
  const cancelled = filtered.filter(record => record.status === 'cancelled');
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-1.5" aria-label="Filtrar documentos">{[{ id: 'all', label: 'Todos' }, { id: 'invoice', label: 'Facturas' }, { id: 'payment', label: 'Pagos' }, { id: 'other', label: 'Comprobantes' }].map(filter => <button key={filter.id} type="button" aria-pressed={kind === filter.id} onClick={() => setKind(filter.id)} className={`rounded-lg border px-3 py-2 text-xs font-medium ${kind === filter.id ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>{filter.label}</button>)}</div>
      <label className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 sm:w-64"><Search className="h-4 w-4 shrink-0 text-slate-400"/><input aria-label="Buscar proyecto en documentos" placeholder="Buscar proyecto" value={projectSearch} onChange={event => setProjectSearch(event.target.value)} className="min-w-0 w-full text-xs outline-none"/></label>
    </div>
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}
    <section aria-label="Documentos por fecha" className="space-y-3">{active.map(card)}</section>
    {cancelled.length > 0 && <details><summary className="cursor-pointer text-xs text-slate-500">Anulados ({cancelled.length})</summary><div className="mt-3 space-y-3">{cancelled.map(card)}</div></details>}
    {!records.length && <p className="py-5 text-center text-sm text-slate-400">Todavía no hay documentos asignados.</p>}
    {!!records.length && !filtered.length && <p className="py-5 text-center text-sm text-slate-400">No hay documentos para esta búsqueda.</p>}
  </div>;
}

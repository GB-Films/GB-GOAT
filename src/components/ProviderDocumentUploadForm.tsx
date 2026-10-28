import { useRef, useState } from 'react';
import { FileText, Search, UploadCloud, X } from 'lucide-react';
import { documentProjectChoices } from '../lib/providerDocumentSelection';

export function ProviderDocumentUploadForm({ kind, lines, records = [], busy, uncertain, onClose, onSave }: {
  kind: 'invoice' | 'other'; lines: any[]; records?: any[]; busy?: boolean; uncertain?: boolean;
  onClose: () => void; onSave: (file: File | null, projectIds: string[]) => Promise<unknown>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const projects = documentProjectChoices(lines, kind, records);
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const visible = projects.filter(project => normalize(project.name).includes(normalize(search.trim())));
  const choose = (files: File[]) => {
    if (files.length !== 1) { setError('Elegí un solo documento por carga.'); return; }
    const next = files[0];
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(next.type) || next.size <= 0 || next.size > 2 * 1024 * 1024) { setError('Usá PDF, JPG, PNG o WEBP de hasta 2 MB.'); return; }
    setFile(next); setError('');
  };
  return <form onSubmit={async event => { event.preventDefault(); event.stopPropagation(); if (busy) return; setError(''); try { await onSave(file, selected); } catch (error: any) { setError(error.message || 'No se pudo guardar el documento.'); } }} className="space-y-4 rounded-xl border border-blue-200 bg-white p-4">
    <header className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">{kind === 'invoice' ? 'Cargar factura' : 'Cargar comprobante'}</h3><button type="button" aria-label="Cancelar carga" disabled={busy || uncertain} onClick={onClose} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-40"><X className="h-4 w-4"/></button></header>
    <fieldset disabled={busy || uncertain} className="space-y-4 disabled:opacity-60">
      <div onDragOver={event => { event.preventDefault(); event.stopPropagation(); if (!busy && !uncertain) setDragging(true); }} onDragLeave={event => { event.preventDefault(); if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={event => { event.preventDefault(); event.stopPropagation(); setDragging(false); if (!busy && !uncertain) choose(Array.from(event.dataTransfer.files)); }}
        className={`rounded-xl border-2 border-dashed p-5 text-center transition-colors ${dragging ? 'border-blue-500 bg-blue-100' : file ? 'border-blue-200 bg-blue-50/40' : 'border-slate-300 bg-slate-50'}`}>
        {file ? <FileText className="mx-auto mb-2 h-7 w-7 text-blue-600"/> : <UploadCloud className="mx-auto mb-2 h-7 w-7 text-slate-400"/>}
        <p className="break-words text-sm font-medium text-slate-700">{file ? file.name : 'Arrastrá el documento acá'}</p>
        <button type="button" onClick={() => input.current?.click()} className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 hover:border-blue-300">{file ? 'Cambiar archivo' : 'Seleccionar archivo'}</button>
        <p className="mt-2 text-[11px] text-slate-400">PDF o imagen · hasta 2 MB</p>
        <input ref={input} aria-label="Documento para cargar" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} onChange={event => { if (event.target.files?.length) choose(Array.from(event.target.files)); event.target.value = ''; }}/>
      </div>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-xs font-semibold text-slate-700">{kind === 'invoice' ? 'Proyectos pendientes de facturar' : 'Proyectos incluidos'}</h4><span className="text-xs text-slate-500">{selected.length} seleccionados</span></div>
        <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2"><Search className="h-4 w-4 text-slate-400"/><input aria-label="Buscar proyecto para asignar" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar proyecto" className="w-full min-w-0 text-xs outline-none"/></label>
        <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">{visible.map(project => <label key={project.id} className={`flex cursor-pointer items-center gap-3 px-3 py-3 text-xs ${selected.includes(project.id) ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
          <input type="checkbox" checked={selected.includes(project.id)} onChange={event => setSelected(current => event.target.checked ? [...current, project.id] : current.filter(id => id !== project.id))} className="h-4 w-4 accent-blue-600"/>
          <span className="min-w-0 flex-1 font-medium text-slate-700">{project.name}</span>{kind === 'invoice' && <span className="shrink-0 tabular-nums text-slate-500">${(project.amountCents / 100).toLocaleString('es-AR')}</span>}
        </label>)}{!visible.length && <p className="p-4 text-center text-xs text-slate-500">{projects.length ? 'Sin coincidencias.' : kind === 'invoice' ? 'No hay proyectos pendientes de facturar.' : 'No hay proyectos para asignar.'}</p>}</div>
      </div>
    </fieldset>
    {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
    {uncertain && <p className="text-xs text-amber-700">Verificá el intento anterior para evitar una carga duplicada.</p>}
    <footer className="flex justify-end gap-2"><button type="button" disabled={busy || uncertain} onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600 disabled:opacity-40">Cancelar</button><button type="submit" disabled={busy || (!uncertain && (!file || !selected.length))} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40">{busy ? 'Guardando…' : uncertain ? 'Verificar / reintentar' : 'Guardar documento'}</button></footer>
  </form>;
}

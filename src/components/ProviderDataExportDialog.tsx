import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Download, Plus, Search, UserRound, X } from 'lucide-react';
import { ProjectDialog } from '../pages/project-detail/ProjectDialog';
import { isExportablePerson, missingProviderInsuranceData, providerExportName, providerPersonalAlias, searchExportProviders, selectedExportProviders } from '../lib/providerDataExport';
import { inferLegacyIdentifiers } from '../lib/providerConstants';
import type { ProviderDataFormat } from '../lib/providerDataWorkbook';

export function ProviderDataExportDialog({ providers, onClose, onExport }: { providers: any[]; onClose: () => void; onExport: (providers: any[], format: ProviderDataFormat) => Promise<void> }) {
  const [search, setSearch] = useState('');
  const [ids, setIds] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [format, setFormat] = useState<ProviderDataFormat>('pdf');
  const input = useRef<HTMLInputElement>(null);
  const resultsList = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef<number | null>(null);
  const results = useMemo(() => searchExportProviders(providers, search, ids), [providers, search, ids]);
  const selected = useMemo(() => selectedExportProviders(providers, ids), [providers, ids]);
  const visible = results.slice(0, 60);
  const activeIndex = Math.min(active, Math.max(0, visible.length - 1));
  useLayoutEffect(() => {
    if (pendingScroll.current !== null && resultsList.current) resultsList.current.scrollTop = pendingScroll.current;
    pendingScroll.current = null;
  }, [ids]);
  const moveActive = (direction: number) => {
    const index = Math.max(0, Math.min(activeIndex + direction, visible.length - 1));
    setActive(index);
    const list = resultsList.current, option = list?.querySelectorAll<HTMLElement>('[role="option"]')[index];
    if (!list || !option) return;
    const bounds = list.getBoundingClientRect(), row = option.getBoundingClientRect();
    if (row.top < bounds.top) list.scrollTop -= bounds.top - row.top;
    else if (row.bottom > bounds.bottom) list.scrollTop += row.bottom - bounds.bottom;
  };
  const incomplete = selected.filter(provider => missingProviderInsuranceData(provider).length).length;
  const add = (provider: any, index: number) => { if (busy) return; pendingScroll.current = resultsList.current?.scrollTop ?? null; setIds(current => current.includes(provider.id) ? current : [...current, provider.id]); setNotice(`${providerExportName(provider)} agregado a la planilla.`); setActive(index); input.current?.focus({ preventScroll: true }); };
  return <ProjectDialog title="Exportar datos" wide onClose={() => { if (!busy) onClose(); }}>
    <div className="space-y-4">
      <p className="text-sm text-slate-500">Seleccioná las personas para armar la planilla con membrete de Gran Berta.</p>
      <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 focus-within:border-blue-400">
        <Search className="h-5 w-5 shrink-0 text-slate-400"/><input ref={input} autoFocus role="combobox" aria-label="Buscar personas para exportar" aria-controls="export-provider-results" aria-expanded={true} aria-autocomplete="list" aria-activedescendant={visible[activeIndex] ? `export-result-${activeIndex}` : undefined}
          placeholder="Buscar por apellido, nombre o apodo" value={search} disabled={busy} onChange={event => { setSearch(event.target.value); setActive(0); if (resultsList.current) resultsList.current.scrollTop = 0; }} className="w-full bg-transparent text-sm outline-none"
          onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); moveActive(event.key === 'ArrowDown' ? 1 : -1); } else if (event.key === 'Enter' && visible[activeIndex]) { event.preventDefault(); add(visible[activeIndex], activeIndex); } }}/>
        {search && <button type="button" disabled={busy} aria-label="Limpiar búsqueda" onClick={() => { setSearch(''); setActive(0); if (resultsList.current) resultsList.current.scrollTop = 0; input.current?.focus({ preventScroll: true }); }} className="rounded p-1 text-slate-400 hover:bg-slate-200"><X className="h-4 w-4"/></button>}
      </label>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-xl border border-slate-200"><header className="flex items-center justify-between bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600"><h3>Personas</h3><span>{results.length} disponibles</span></header>
          <div ref={resultsList} id="export-provider-results" role="listbox" aria-label="Resultados de personas" className="max-h-[360px] overflow-y-auto divide-y divide-slate-100">
            {visible.map((provider, index) => <button key={provider.id} id={`export-result-${index}`} role="option" aria-selected={index === activeIndex} type="button" disabled={busy} onClick={() => add(provider, index)} className={`flex w-full items-center gap-3 px-4 py-3 text-left disabled:opacity-50 ${index === activeIndex ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
              <UserRound className="h-4 w-4 shrink-0 text-slate-400"/><span className="min-w-0 flex-1"><span className="block text-sm font-medium text-slate-900">{providerExportName(provider)} {providerPersonalAlias(provider) && <span className="ml-1 text-xs font-normal text-slate-500">({providerPersonalAlias(provider)})</span>}</span>
                <span className="mt-0.5 block text-xs text-slate-500">DNI {inferLegacyIdentifiers(provider).dniNormalized || 'sin informar'}</span></span><Plus className="h-4 w-4 shrink-0 text-blue-600"/>
            </button>)}
            {!results.length && <p className="p-6 text-center text-sm text-slate-400">{providers.some(isExportablePerson) ? 'No hay más coincidencias.' : 'No hay personas para exportar.'}</p>}
          </div>
          {results.length > visible.length && <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">Escribí para encontrar más personas.</p>}
        </section>
        <section className="overflow-hidden rounded-xl border border-slate-200"><header className="flex items-center justify-between bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600"><h3>En la planilla · {selected.length}</h3>{!!selected.length && <button type="button" disabled={busy} onClick={() => setIds([])} className="text-slate-400 hover:text-slate-700">Vaciar</button>}</header>
          <div className="max-h-[360px] overflow-y-auto divide-y divide-slate-100">{selected.map(provider => {
            const missing = missingProviderInsuranceData(provider);
            return <div key={provider.id} className="flex items-start gap-3 px-4 py-3"><div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-900">{providerExportName(provider)}</p>{!!missing.length && <p className="mt-1 text-xs text-amber-700">Falta: {missing.join(', ')}</p>}</div><button type="button" disabled={busy} aria-label={`Quitar a ${providerExportName(provider)}`} onClick={() => setIds(current => current.filter(id => id !== provider.id))} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><X className="h-4 w-4"/></button></div>;
          })}{!selected.length && <p className="p-6 text-center text-sm text-slate-400">Buscá y agregá personas con el botón +.</p>}</div>
        </section>
      </div>
      <p className="text-xs text-slate-500">Nombre, DNI, CUIL/CUIT, nacimiento, domicilio, oficio, teléfono y correo.</p>
      {!!incomplete && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{incomplete} {incomplete === 1 ? 'persona tiene datos incompletos' : 'personas tienen datos incompletos'}. Quedarán señalados en la planilla.</p>}
      <p role="status" className="sr-only">{notice}</p>
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-600 disabled:opacity-40">Cerrar</button>
        <select aria-label="Formato de descarga" disabled={busy} value={format} onChange={event => setFormat(event.target.value as ProviderDataFormat)} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700"><option value="pdf">PDF (.pdf)</option><option value="xlsx">Excel (.xlsx)</option></select>
        <button type="button" disabled={busy || !selected.length} onClick={async () => { setBusy(true); setError(''); try { await onExport(selected, format); setNotice('El archivo se descargó correctamente.'); } catch { setError('No se pudo generar el archivo. Volvé a intentar.'); } finally { setBusy(false); } }} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"><Download className="h-4 w-4"/>{busy ? 'Preparando archivo…' : `Descargar ${format === 'pdf' ? 'PDF' : 'Excel'}${selected.length ? ` (${selected.length})` : ''}`}</button>
      </footer>
    </div>
  </ProjectDialog>;
}

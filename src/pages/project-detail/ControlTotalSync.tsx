import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Download, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { authorizeControlTotal, canSyncControlTotal, controlTotalRequest, type SyncPreview, type SyncResolution, type SyncResult } from '../../lib/controlTotalSync';
import { ProjectDialog } from './ProjectDialog';

const money = (value: number) => Number(value || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 });
const labels: Record<string, string> = { create: 'Nuevo', update: 'Modificado', same: 'Coincide', included: 'Ya incluido', pending: 'Pendiente', void: 'Anular' };

export function ControlTotalSync({ projectId }: { projectId: string }) {
  const { user, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [last, setLast] = useState<SyncResult | null>(null);
  const [config, setConfig] = useState<SyncPreview['config']>({ projectId: '', serviceDate: '', serviceDateMode: 'project' });
  const [resolutions, setResolutions] = useState<Record<string, SyncResolution>>({});
  const [expanded, setExpanded] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [needsCompare, setNeedsCompare] = useState(false);
  const inFlight = useRef(false);
  const allowed = canSyncControlTotal(user?.email, isAdmin);
  useEffect(() => {
    let active = true;
    setPreview(null); setResult(null); setLast(null); setConfig({ projectId: '', serviceDate: '', serviceDateMode: 'project' }); setResolutions({});
    if (allowed) void controlTotalRequest<{ lastRun: SyncResult | null; config?: typeof config }>({ action: 'status', projectId }).then(s => {
      if (active) { setLast(s.lastRun); if (s.config) setConfig(s.config); }
    }).catch(() => { /* A not-yet-deployed endpoint must not break the project. */ });
    return () => { active = false; };
  }, [allowed, projectId]);

  const compare = async () => {
    if (!user || inFlight.current) return;
    inFlight.current = true; setBusy('Comparando…'); setError(''); setResult(null);
    try {
      const accessToken = await authorizeControlTotal(user);
      const data = await controlTotalRequest<SyncPreview>({ action: 'preview', projectId, accessToken, config, resolutions });
      setPreview(data); setConfig(data.config); setResolutions(data.resolutions || {}); setUncertain(data.recover === true); setNeedsCompare(false);
    } catch (e) { setError((e as Error).message || 'No se pudo comparar.'); }
    finally { inFlight.current = false; setBusy(''); }
  };
  const apply = async () => {
    if (!user || !preview || inFlight.current) return;
    inFlight.current = true; setBusy(uncertain ? 'Verificando el lote…' : 'Actualizando CT…'); setError('');
    try {
      const accessToken = await authorizeControlTotal(user);
      const data = await controlTotalRequest<SyncResult>({ action: 'apply', projectId, runId: preview.runId, accessToken });
      setResult(data); setLast(data); setUncertain(false);
    } catch (e) {
      setError((e as Error).message || 'No se pudo confirmar el lote.');
      const code = (e as { code?: string }).code || '';
      setUncertain((e as { details?: { ctSyncRecovery?: boolean } }).details?.ctSyncRecovery === true || ['functions/unavailable', 'functions/deadline-exceeded', 'functions/internal', 'functions/unknown', 'functions/cancelled'].includes(code));
    } finally { inFlight.current = false; setBusy(''); }
  };
  const resolve = (key: string, patch: Partial<SyncResolution>) => {
    setResolutions(r => ({ ...r, [key]: { mode: 'direct', ...r[key], ...patch } }));
    setResult(null); setNeedsCompare(true);
  };
  const dirty = preview && needsCompare;
  const exportReport = () => {
    const data = { projectId, generatedAt: new Date().toISOString(), result, config, summary: preview?.summary, items: preview?.items };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `control-ct-${projectId}.json`; a.click(); URL.revokeObjectURL(url);
  };
  if (!allowed) return null;
  return <>
    <button type="button" onClick={() => setOpen(true)} title={last ? `Última actualización: ${new Date(last.at).toLocaleString('es-AR')}` : 'Comparar y actualizar los costos del proyecto en Control Total'}
      className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[10px] font-bold text-blue-800 shadow-sm hover:bg-blue-100 sm:px-3.5 sm:py-2 sm:text-[11px]">
      <RefreshCw className="h-3.5 w-3.5" /><span className="hidden sm:inline">Actualizar con CT</span><span className="sm:hidden">CT</span>
    </button>
    {open && <ProjectDialog title="Actualizar con Control Total" onClose={() => { if (!busy) setOpen(false); }}>
      <p className="text-sm text-slate-600">Compará los costos y revisá los cambios antes de aplicarlos. Los pagos se concilian por separado; esta actualización no mueve dinero.</p>
      {last && <p className="mt-2 text-xs text-slate-500">Última actualización: {new Date(last.at).toLocaleString('es-AR')} · {last.status === 'partial' ? 'con pendientes' : 'costos verificados'}</p>}
      {error && <p role="alert" className="my-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {!preview && <button type="button" disabled={!!busy} onClick={() => void compare()} className="mt-4 rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy || 'Conectar Google y comparar'}</button>}
      {preview && <>
        <div className="my-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-slate-600">Proyecto CT
            <select value={config.projectId} disabled={!!busy || uncertain} onChange={e => { setConfig(c => ({ ...c, projectId: e.target.value })); setNeedsCompare(true); }} className="mt-1 block w-full rounded-lg border p-2 font-normal">
              <option value="">Elegí el proyecto</option>{preview.projects.map(p => <option key={p.id} value={p.id}>{p.id}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">Fecha por defecto para servicios nuevos
            <input type="date" value={config.serviceDate} disabled={!!busy || uncertain} onChange={e => { const value = e.target.value; setConfig(c => ({ ...c, serviceDate: value, serviceDateMode: value ? 'manual' : 'project' })); setNeedsCompare(true); }} className="mt-1 block w-full rounded-lg border p-2 font-normal" />
            <span className="mt-1 block font-normal">Se toma el último día de rodaje o, si falta, el primero. Podés cambiarla; vaciala para volver a usar el rodaje.</span>
          </label>
        </div>
        <div className="my-3 flex flex-wrap gap-2 text-xs font-bold">
          <span className="rounded bg-blue-50 px-3 py-2">Nuevos: {preview.summary.create}</span><span className="rounded bg-blue-50 px-3 py-2">Modificados: {preview.summary.update}</span>
          <span className="rounded bg-amber-50 px-3 py-2">Pendientes: {preview.summary.pending}</span><span className="rounded bg-slate-100 px-3 py-2">Coinciden: {preview.summary.same + preview.summary.included}</span>
          {!!preview.summary.void && <span className="rounded bg-red-50 px-3 py-2">Anulaciones: {preview.summary.void}</span>}
        </div>
        <div className="max-h-[32dvh] space-y-2 overflow-y-auto">
          {preview.items.map(item => <div key={item.key} className="rounded-lg border border-slate-200 p-3 text-sm">
            <div className="flex justify-between gap-3"><span className="font-semibold">{item.name}</span><span className="whitespace-nowrap">{item.currency || 'ARS'} {money(item.amount)}</span></div>
            {item.ctAmount != null && item.ctAmount !== item.amount && <p className="mt-1 text-xs font-semibold text-blue-800">CT actual: {money(item.ctAmount)} → GOAT: {money(item.amount)}</p>}
            <p className="mt-1 text-xs text-slate-500">{labels[item.status] || item.status} · {item.message}</p>
            {!!item.paymentCount && <p className="mt-1 text-xs text-amber-800">Pagos GOAT: {item.paymentCount}. Pendientes de comprobación en CT.</p>}
            {!result && !uncertain && <button type="button" disabled={!!busy} onClick={() => setExpanded(expanded === item.key ? '' : item.key)} className="mt-2 text-xs font-bold text-blue-700">{expanded === item.key ? 'Cerrar opciones' : 'Revisar vínculo'}</button>}
            {expanded === item.key && !result && !uncertain && <div className="mt-3 space-y-2 border-t pt-3">
              <select aria-label={`Tratamiento de ${item.name}`} value={resolutions[item.key]?.mode || 'direct'} onChange={e => resolve(item.key, { mode: e.target.value as SyncResolution['mode'], ...(e.target.value === 'new' ? { serviceIds: [] } : {}) })} className="w-full rounded border p-2">
                <option value="direct">Vincular con un servicio existente</option><option value="new">Confirmar que es un costo nuevo</option><option value="included">Ya incluido en otro costo, sueldo o rendición</option><option value="exclude">Presupuesto / excluir con motivo</option>{item.canVoid && <option value="void">Anular costo eliminado, sin pagos</option>}
              </select>
              <select aria-label={`Servicio CT de ${item.name}`} multiple={resolutions[item.key]?.mode === 'included'} size={resolutions[item.key]?.mode === 'included' ? 4 : undefined}
                value={resolutions[item.key]?.mode === 'included' ? resolutions[item.key]?.serviceIds || [] : resolutions[item.key]?.serviceIds?.[0] || ''}
                onChange={e => resolve(item.key, { serviceIds: Array.from(e.currentTarget.selectedOptions as HTMLCollectionOf<HTMLOptionElement>).map(o => o.value).filter(Boolean) })} className="w-full rounded border p-2">
                <option value="">Servicio CT (si corresponde)</option>{preview.services.map(s => <option key={s.id} value={s.id}>{s.projectId} · {s.name} · {money(s.amount)}</option>)}
              </select>
              {resolutions[item.key]?.mode === 'included' && <p className="text-xs text-slate-500">Podés vincular varios servicios si el costo está repartido entre proyectos.</p>}
              <select aria-label={`Proveedor CT de ${item.name}`} value={resolutions[item.key]?.providerId || ''} onChange={e => resolve(item.key, { providerId: e.target.value })} className="w-full rounded border p-2">
                <option value="">Conservar proveedor o detectar coincidencia exacta</option>{preview.providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select aria-label={`Proyecto destino de ${item.name}`} value={resolutions[item.key]?.projectId || ''} onChange={e => resolve(item.key, { projectId: e.target.value })} className="w-full rounded border p-2">
                <option value="">Proyecto de referencia</option>{preview.projects.map(p => <option key={p.id} value={p.id}>{p.id}</option>)}
              </select>
              <input aria-label={`Motivo de ${item.name}`} placeholder="Motivo o aclaración (obligatorio al incluir, excluir o anular)" value={resolutions[item.key]?.reason || ''} onChange={e => resolve(item.key, { reason: e.target.value })} className="w-full rounded border p-2" />
            </div>}
          </div>)}
        </div>
        {!!preview.summary.paymentsPending && <p className="my-3 rounded bg-amber-50 p-3 text-xs text-amber-900">Este lote contiene {preview.summary.paymentsPending} registros de pago GOAT. No se crearán transferencias ni se marcarán como conciliados automáticamente.</p>}
        {result ? <p role="status" className="my-3 flex items-center gap-2 rounded bg-emerald-50 p-3 text-sm text-emerald-900"><CheckCircle2 className="h-5 w-5" />{result.sourceChanged ? 'El lote se verificó en CT, pero GOAT volvió a cambiar. Compará otra vez para ver las novedades.' : result.status === 'partial' ? 'Cambios aplicados y verificados. Quedan pendientes separados.' : 'Costos actualizados y verificados en CT.'}</p> : null}
        {uncertain && <p className="my-3 flex items-center gap-2 text-xs text-amber-900"><AlertCircle className="h-4 w-4" />Se conserva el mismo lote para verificar el resultado sin duplicar registros.</p>}
        <footer className="mt-4 flex flex-wrap gap-2 border-t pt-4">
          {!uncertain && <button type="button" disabled={!!busy} onClick={() => void compare()} className="rounded-lg border px-3 py-2 text-sm font-bold disabled:opacity-50">{busy || (result ? 'Comparar otra vez' : 'Recalcular vista previa')}</button>}
          {!result && <button type="button" disabled={!!busy || !!dirty} onClick={() => void apply()} className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-40">{busy || (uncertain ? 'Verificar / reintentar el mismo lote' : 'Aplicar cambios revisados')}</button>}
          <button type="button" onClick={exportReport} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm"><Download className="h-4 w-4" />Guardar control</button>
        </footer>
        {dirty && !result && <p className="mt-2 text-xs text-blue-800">Recalculá la vista previa para incorporar tus decisiones antes de aplicar.</p>}
      </>}
    </ProjectDialog>}
  </>;
}

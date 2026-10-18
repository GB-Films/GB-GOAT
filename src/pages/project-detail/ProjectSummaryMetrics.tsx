import { cn } from '../../lib/utils';

export function ProjectSummaryMetrics({ isProjectAdmin, budget, cost, incidences, balance }: {
  isProjectAdmin: boolean; budget: number; cost: number; incidences: number; balance: number;
}) {
  const metrics = [
    { label: isProjectAdmin ? 'Presupuesto' : 'Presupuesto asignado', value: budget, tone: 'text-slate-950' },
    { label: 'Costo proyectado', value: cost, tone: 'text-rose-600' },
    ...(isProjectAdmin ? [{ label: 'Incidencias', value: incidences, tone: 'text-rose-600' }] : []),
    { label: 'Saldo', value: balance, tone: balance >= 0 ? 'text-emerald-600' : 'text-rose-600' },
  ];
  return <div aria-label="Totales del proyecto" className={cn('grid grid-cols-2 gap-1.5 sm:gap-2', isProjectAdmin ? 'lg:grid-cols-4' : 'sm:grid-cols-3')}>
    {metrics.map(metric => <div key={metric.label} className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 sm:px-4 sm:py-3">
      <div className="text-[8px] font-black uppercase tracking-wide text-slate-400 sm:text-[9px] sm:tracking-widest">{metric.label}</div>
      <div className={cn('overflow-x-auto whitespace-nowrap font-mono text-sm font-black sm:mt-1 sm:text-xl', metric.tone)}>${metric.value.toLocaleString()}</div>
    </div>)}
  </div>;
}

import { cn } from '../../lib/utils';

export function AreaBudgetSummary({ assigned, spent, balance, areas }: {
  assigned: number;
  spent: number;
  balance: number;
  areas: string[];
}) {
  const selectedLabel = `${areas.length} ${areas.length === 1 ? 'área seleccionada' : 'áreas seleccionadas'} · ${areas.join(', ')}`;
  return (
    <section aria-label="Resumen presupuesto de áreas" className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm sm:h-[50px] sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
      <div className="min-w-0 sm:flex-1">
        <h3 className="text-[10px] font-black uppercase leading-4 tracking-widest text-slate-700">Resumen presupuesto</h3>
        <p title={selectedLabel} className="truncate text-[9px] leading-3 text-slate-500">{selectedLabel}</p>
      </div>
      <dl className="grid grid-cols-3 gap-3 sm:shrink-0 sm:gap-8 sm:text-right lg:gap-12">
        <div>
          <dt className="text-[9px] font-bold uppercase leading-3 tracking-widest text-slate-400">Presupuesto</dt>
          <dd className="whitespace-nowrap font-mono text-xs font-bold leading-5 text-slate-900 sm:text-sm">${assigned.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-[9px] font-bold uppercase leading-3 tracking-widest text-slate-400">Gasto global</dt>
          <dd className="whitespace-nowrap font-mono text-xs font-bold leading-5 text-red-600 sm:text-sm">${spent.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-[9px] font-bold uppercase leading-3 tracking-widest text-slate-400">Saldo</dt>
          <dd className={cn('whitespace-nowrap font-mono text-xs font-bold leading-5 sm:text-sm', balance >= 0 ? 'text-emerald-600' : 'text-red-600')}>${balance.toLocaleString()}</dd>
        </div>
      </dl>
    </section>
  );
}

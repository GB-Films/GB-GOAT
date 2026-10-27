import { cn } from '../../lib/utils';

export function CashBoxPicker({ rows, value, onChange, showGeneral, generalOut }: {
  rows: Array<{ email: string; responsible: { displayName?: string }; balance: number }>;
  value: string; onChange: (value: string) => void; showGeneral: boolean; generalOut: number;
}) {
  const options = [
    ...(showGeneral ? [{ id: 'all', name: 'Todas', amount: null, email: '' }] : []),
    ...(showGeneral ? [{ id: 'general', name: 'Caja General', amount: generalOut, email: '' }] : []),
    ...rows.map(row => ({ id: row.email, name: row.responsible.displayName || row.email, amount: row.balance, email: row.email })),
  ];
  const selected = options.find(option => option.id === value);
  return <>
    {showGeneral && <nav aria-label="Filtrar cajas" className="flex flex-wrap gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
      {options.map(option => <button key={option.id} type="button" onClick={() => onChange(option.id)}
        aria-pressed={value === option.id} title={option.email || option.name} aria-label={option.email ? `${option.name} · ${option.email}` : option.name}
        className={cn('rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-blue-500', value === option.id
          ? 'border-blue-500 bg-blue-50 font-semibold text-blue-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}>
        <span className="block">{option.name}</span>
        {value === 'all' && option.email && <>
          <span className="mt-0.5 block text-xs font-normal text-slate-500">{option.email}</span>
          <span className={cn('mt-1 block font-mono font-semibold', option.amount! >= 0 ? 'text-emerald-700' : 'text-red-700')}>${option.amount?.toLocaleString('es-AR')}</span>
        </>}
      </button>)}
    </nav>}
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-4 py-4 sm:px-5">
    <div className="min-w-0">
      <h3 className="text-sm font-bold text-slate-900">{value === 'all' && showGeneral ? 'Todas las cajas' : selected?.name || 'Mi caja'}</h3>
      {selected?.email && <p className="mt-1 break-all text-xs text-slate-500">{selected.email}</p>}
    </div>
    {selected && selected.amount !== null && <div className="shrink-0 text-right">
      <div className="text-xs text-slate-500">{value === 'general' ? 'Salida neta' : 'Saldo'}</div>
      <div className={cn('font-mono text-2xl font-bold tabular-nums', value === 'general' ? 'text-slate-900' : selected.amount >= 0 ? 'text-emerald-700' : 'text-red-700')}>${selected.amount.toLocaleString('es-AR')}</div>
    </div>}
    </div>
  </>;
}

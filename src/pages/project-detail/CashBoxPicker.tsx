import { cn } from '../../lib/utils';

export function CashBoxPicker({ rows, value, onChange, showGeneral, generalOut }: {
  rows: Array<{ email: string; responsible: { displayName?: string }; balance: number; availableBalance?: number; pendingOutgoing?: number; pendingIncoming?: number }>;
  value: string; onChange: (value: string) => void; showGeneral: boolean; generalOut: number;
}) {
  const options = [
    ...(showGeneral ? [{ id: 'all', name: 'Todas', amount: null, email: '', available: 0, pendingOutgoing: 0, pendingIncoming: 0 }] : []),
    ...(showGeneral ? [{ id: 'general', name: 'Caja General', amount: generalOut, email: '', available: 0, pendingOutgoing: 0, pendingIncoming: 0 }] : []),
    ...rows.map(row => ({ id: row.email, name: row.responsible.displayName || row.email, amount: row.balance, email: row.email,
      available: row.availableBalance ?? row.balance, pendingOutgoing: row.pendingOutgoing || 0, pendingIncoming: row.pendingIncoming || 0 })),
  ];
  const hasPending = (option: typeof options[number]) => option.pendingOutgoing > 0 || option.pendingIncoming > 0;
  const pendingDetails = (option: typeof options[number]) => <>
    {option.pendingOutgoing > 0 && <span className="mt-1 block text-xs font-normal text-amber-800">Por confirmar: ${option.pendingOutgoing.toLocaleString('es-AR')}</span>}
    {option.pendingIncoming > 0 && <span className="mt-1 block text-xs font-normal text-amber-800">Por recibir: ${option.pendingIncoming.toLocaleString('es-AR')}</span>}
    {option.pendingOutgoing > 0 && <span className={cn('mt-0.5 block text-xs font-normal', option.available < 0 ? 'text-red-700' : 'text-slate-600')}>Disponible: ${option.available.toLocaleString('es-AR')}</span>}
  </>;
  const selected = options.find(option => option.id === value);
  return <>
    {showGeneral && <nav aria-label="Filtrar cajas" className="flex flex-wrap gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
      {options.map(option => <button key={option.id} type="button" onClick={() => onChange(option.id)}
        aria-pressed={value === option.id} title={option.email || option.name} aria-label={option.email ? `${option.name} · ${option.email}${hasPending(option) ? ' · Movimientos pendientes de confirmación' : ''}` : option.name}
        className={cn('rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-blue-500', hasPending(option)
          ? cn('border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100', value === option.id && 'ring-1 ring-blue-500') : value === option.id
          ? 'border-blue-500 bg-blue-50 font-semibold text-blue-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}>
        <span className="block">{option.name}</span>
        {value === 'all' && option.email && <>
          <span className="mt-0.5 block text-xs font-normal text-slate-500">{option.email}</span>
          <span className={cn('mt-1 block font-mono font-semibold', option.amount! < 0 ? 'text-red-700' : hasPending(option) ? 'text-amber-800' : 'text-emerald-700')}>${option.amount?.toLocaleString('es-AR')}</span>
          {pendingDetails(option)}
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
      <div className={cn('font-mono text-2xl font-bold tabular-nums', value === 'general' ? 'text-slate-900' : selected.amount < 0 ? 'text-red-700' : hasPending(selected) ? 'text-amber-800' : 'text-emerald-700')}>${selected.amount.toLocaleString('es-AR')}</div>
      {pendingDetails(selected)}
    </div>}
    </div>
  </>;
}

import { cn } from '../../lib/utils';

export function CashBoxPicker({ rows, value, onChange, showGeneral, generalOut }: {
  rows: Array<{ email: string; responsible: { displayName?: string }; balance: number }>;
  value: string; onChange: (value: string) => void; showGeneral: boolean; generalOut: number;
}) {
  const options = [
    ...(showGeneral ? [{ id: 'general', name: 'Caja General', amount: generalOut, email: '' }] : []),
    ...rows.map(row => ({ id: row.email, name: row.responsible.displayName || row.email, amount: row.balance, email: row.email })),
  ];
  const selected = options.find(option => option.id === value);
  return <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-4 py-4 sm:px-5">
    <div className="min-w-0">
      {options.length > 1 ? <>
        <label htmlFor="cash-box" className="sr-only">Ver caja</label>
        <select id="cash-box" value={value} onChange={event => onChange(event.target.value)}
          className="max-w-full rounded-lg border border-slate-200 bg-white py-2 pl-3 pr-8 text-sm font-semibold text-slate-900 focus:outline-blue-500">
          {options.map(option => <option key={option.id} value={option.id}>{option.name}{option.email ? ` · ${option.email}` : ''}</option>)}
        </select>
      </> : <h3 className="text-sm font-bold text-slate-900">{selected?.name || 'Mi caja'}</h3>}
      {selected?.email && <p className="mt-1 break-all text-xs text-slate-500">{selected.email}</p>}
    </div>
    {selected && <div className="shrink-0 text-right">
      <div className="text-xs text-slate-500">{value === 'general' ? 'Salida neta' : 'Saldo'}</div>
      <div className={cn('font-mono text-2xl font-bold tabular-nums', value === 'general' ? 'text-slate-900' : selected.amount >= 0 ? 'text-emerald-700' : 'text-red-700')}>${selected.amount.toLocaleString('es-AR')}</div>
    </div>}
  </div>;
}

import { cn } from '../../lib/utils';

export function CashBoxPicker({ rows, value, onChange, showGeneral, generalOut }: {
  rows: Array<{ email: string; responsible: { displayName?: string }; balance: number; received: number; movements: any[] }>;
  value: string; onChange: (value: string) => void; showGeneral: boolean; generalOut: number;
}) {
  const options = [
    ...(showGeneral ? [{ id: 'general', name: 'Caja General', amount: generalOut, detail: 'Salida neta · no es saldo disponible', pending: 0 }] : []),
    ...rows.map(row => ({ id: row.email, name: row.responsible.displayName || row.email, amount: row.balance,
      detail: `Recibido $${row.received.toLocaleString('es-AR')} · saldo disponible`,
      pending: row.movements.filter(m => m.type === 'entrega' && m.status === 'pending').reduce((sum, m) => sum + Number(m.amount || 0), 0),
    })),
  ];
  return <section aria-label="Elegir caja" className="order-3 space-y-2">
    <h3 className="text-sm font-bold">Cajas con movimientos</h3>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{options.map(option => <button type="button" key={option.id}
      onClick={() => onChange(option.id)} aria-pressed={value === option.id}
      className={cn('min-w-0 rounded-xl border p-3 text-left', value === option.id ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-slate-200 bg-white')}>
      <span className="block truncate text-xs font-bold" title={option.name}>{option.name}</span>
      <span className={cn('mt-1 block font-mono text-lg font-black', option.id === 'general' ? 'text-slate-900' : option.amount >= 0 ? 'text-emerald-600' : 'text-red-600')}>${option.amount.toLocaleString('es-AR')}</span>
      <span className="block text-[10px] text-slate-500">{option.detail}</span>
      {option.pending > 0 && <span className="mt-1 block text-[10px] font-bold text-amber-700">Pendiente de recibir ${option.pending.toLocaleString('es-AR')}</span>}
    </button>)}</div>
  </section>;
}

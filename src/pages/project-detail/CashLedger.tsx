import type { ReactNode } from 'react';
import { cashLedgerEntry, cashMovementCashbox, sortCashMovements } from '../../lib/cashLedgerView';
import { cn } from '../../lib/utils';
import type { CashMovement } from './types';
import './cashLedger.css';

export function CashLedger({ movements, account, budgetItems, areaExpenses, renderActions, people = [] }: {
  movements: CashMovement[];
  account: string;
  budgetItems: Array<{ id: string; providerName?: string; description?: string }>;
  areaExpenses: Array<{ id: string; providerName?: string; description?: string }>;
  renderActions: (movement: CashMovement) => ReactNode;
  people?: Array<{ email: string; displayName?: string }>;
}) {
  const overview = account === 'all';
  const columns = ['Fecha', ...(overview ? ['Caja'] : []), 'Movimiento', 'Proveedor / persona', 'Descripción', 'Monto', ''];
  return <div className="cash-ledger overflow-auto md:max-h-[65dvh]">
    <table className="w-full text-left text-sm">
      <caption className="sr-only">Movimientos de caja, del más reciente al más antiguo</caption>
      <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
        <tr>{columns.map((label, index) =>
          <th key={index} scope="col" className={cn('px-4 py-3 font-medium', label === 'Monto' && 'text-right')}>
            {label || <span className="sr-only">Acciones</span>}
          </th>)}</tr>
      </thead>
      <tbody className="divide-y divide-slate-100">{sortCashMovements(movements).map(movement => {
        const entry = cashLedgerEntry(movement, account, budgetItems, areaExpenses);
        const cashbox = overview ? cashMovementCashbox(movement, people) : null;
        return <tr key={movement.id} className={cn('align-top', entry.pending && 'bg-amber-50/60', entry.cancelled && 'text-slate-400')}>
          <td data-label="Fecha" className="whitespace-nowrap px-4 py-3 text-xs text-slate-600"><span>{entry.date}</span></td>
          {cashbox && <td data-label="Caja" className="px-4 py-3">
            <span className="block font-medium text-slate-700">{cashbox.name}</span>
            {cashbox.email && <span className="mt-0.5 block break-all text-xs text-slate-500">{cashbox.email}</span>}
          </td>}
          <td data-label="Movimiento" className="px-4 py-3">
            <span className="font-semibold text-slate-900">{entry.label}</span>
            {entry.pending && <span className="mt-1 block w-fit rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Pendiente de recepción</span>}
            {entry.cancelled && <span className="mt-1 block text-xs">Cancelada</span>}
          </td>
          <td data-label="Proveedor / persona" className="px-4 py-3">
            <span className="block font-medium text-slate-700">{entry.counterparty.name}</span>
            {entry.counterparty.email && <span className="mt-0.5 block break-all text-xs text-slate-500">{entry.counterparty.email}</span>}
          </td>
          <td data-label="Descripción" className="max-w-sm break-words px-4 py-3 text-slate-600"><span>{entry.description}</span></td>
          <td data-label="Monto" className={cn('whitespace-nowrap px-4 py-3 text-right font-mono font-bold tabular-nums',
            entry.cancelled ? 'text-slate-400 line-through' : entry.pending ? 'text-amber-700' : !overview && entry.signedAmount >= 0 ? 'text-emerald-700' : 'text-slate-900')}>
            <span>{!overview && !entry.pending && !entry.cancelled && (entry.signedAmount >= 0 ? '+' : '−')}${Math.abs(entry.signedAmount).toLocaleString('es-AR')}</span>
          </td>
          <td data-label="Acciones" className="px-4 py-3"><div className="flex flex-wrap justify-end gap-2">{renderActions(movement)}</div></td>
        </tr>;
      })}</tbody>
    </table>
    {movements.length === 0 && <p className="px-4 py-10 text-center text-sm text-slate-500">Sin movimientos de caja</p>}
  </div>;
}

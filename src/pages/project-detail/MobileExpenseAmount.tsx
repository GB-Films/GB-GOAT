import { useState } from 'react';
import { mobileExpenseAmountUpdate } from '../../lib/mobileExpenseAmount';
import { cn } from '../../lib/utils';
import { ProjectDialog } from './ProjectDialog';
import { sameExpenseVersion, samePaymentTarget } from '../../lib/expenseEdits';

export function MobileExpenseAmount({ item, canEdit, paidAmount, onUpdate }: {
  item: any; canEdit: boolean; paidAmount: number; onUpdate: (id: string, updates: any) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [total, setTotal] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [openedItem, setOpenedItem] = useState<any>(null);
  const fullyPaid = item.paid === true || (paidAmount > 0 && paidAmount >= Number(item.total || 0));
  return <>
    <button type="button" onClick={() => {
      setTotal(Number(item.total) ? String(item.total).replace('.', ',') : '');
      setQuantity(String(Number(item.quantity) > 0 ? item.quantity : 1));
      setOpenedItem(item); setError(''); setOpen(true);
    }} className="shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-right"
      title={canEdit ? 'Ingresar o editar importe del gasto' : 'Ver importe del gasto'}>
      <span className="block text-[9px] font-bold uppercase text-slate-500">Total {canEdit ? '· Editar' : ''}</span>
      <span className={cn('block font-mono text-sm font-black', fullyPaid ? 'text-emerald-600' : 'text-slate-900')}>${Number(item.total || 0).toLocaleString('es-AR')}</span>
      {paidAmount > 0 && <span className="block text-[9px] font-bold text-emerald-600">Pagado ${paidAmount.toLocaleString('es-AR')}</span>}
    </button>
    {open && <ProjectDialog title={canEdit ? 'Importe del gasto' : 'Detalle del importe'} onClose={() => { if (!saving) setOpen(false); }}>
      <form className="space-y-4" onSubmit={async event => {
        event.preventDefault(); if (!canEdit || saving) return;
        try {
          if (!sameExpenseVersion(openedItem?.updatedAt, item.updatedAt) || !samePaymentTarget(openedItem, item)) {
            throw new Error('El gasto cambió mientras editabas. Cerrá y volvé a abrir el importe para revisar los datos actuales.');
          }
          const updates = mobileExpenseAmountUpdate(total, quantity);
          setSaving(true); setError(''); await onUpdate(item.id, updates); setOpen(false);
        } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar el importe.'); }
        finally { setSaving(false); }
      }}>
        <label className="block text-xs font-bold">Total del gasto
          <input autoFocus aria-label="Total del gasto" value={total} onChange={e => setTotal(e.target.value)} disabled={!canEdit || saving}
            inputMode="decimal" required placeholder="0,00" className="mt-1 w-full rounded-lg border border-slate-200 p-3 text-lg" /></label>
        <label className="block text-xs font-bold">Cantidad
          <input aria-label="Cantidad" value={quantity} onChange={e => setQuantity(e.target.value)} disabled={!canEdit || saving}
            inputMode="decimal" required className="mt-1 w-full rounded-lg border border-slate-200 p-3 text-base" /></label>
        <p className="text-xs text-slate-500">El precio unitario se calcula como total dividido por cantidad. No registra un pago ni mueve la caja.</p>
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
        {canEdit && <button disabled={saving} type="submit" className="w-full rounded-lg bg-slate-900 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Guardando...' : 'Guardar importe'}</button>}
      </form>
    </ProjectDialog>}
  </>;
}

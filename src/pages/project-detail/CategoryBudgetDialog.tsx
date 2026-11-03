import { useEffect, useRef, useState, type FormEvent } from 'react';
import { parsePaymentAmount } from '../../lib/paymentAmounts';
import { validCategoryBudget } from '../../lib/categoryBudgets';

export function CategoryBudgetDialog({ create, area, amount, detailedBudget, minimum, onClose, onSave }: {
  create: boolean; area: string; amount: number | null; detailedBudget: number; minimum: number;
  onClose: () => void; onSave: (area: string, amount: number | null) => Promise<void>;
}) {
  const [name, setName] = useState(area);
  const [assigned, setAssigned] = useState(create ? false : true);
  const [value, setValue] = useState(amount === null ? (detailedBudget ? String(detailedBudget) : '') : String(amount));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); previous?.focus(); };
  }, []);
  const budget = parsePaymentAmount(value);
  const invalid = assigned ? (!value.trim() || !/^[\d\s.,]+$/.test(value.trim()) || !validCategoryBudget(budget) || budget < minimum) : detailedBudget < minimum;
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy || invalid) return;
    setBusy(true); setError('');
    try { await onSave(create ? name.trim() : area, assigned ? budget : null); onClose(); }
    catch (e: any) { setError(e.message || 'No pudimos guardar el presupuesto. Intentá nuevamente.'); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} aria-labelledby="category-budget-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-auto rounded-2xl border-0 bg-white p-0 shadow-2xl backdrop:bg-black/60">
      <form onSubmit={submit} className="space-y-5 p-6">
        <div><h2 id="category-budget-title" className="text-lg font-bold text-slate-900">{create ? 'Nueva categoría' : `Presupuesto de ${area}`}</h2>
          <p className="mt-1 text-sm text-slate-500">Asigná un importe global. El detalle de los gastos se carga en Áreas.</p></div>
        {create && <label className="block text-sm font-semibold">Nombre de la categoría<input autoFocus value={name} onChange={e => setName(e.target.value)} required maxLength={120} disabled={busy} className="mt-2 w-full rounded-lg border p-3 font-normal" placeholder="Ej.: Arte" /></label>}
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={assigned} onChange={e => setAssigned(e.target.checked)} disabled={busy} className="h-4 w-4 accent-indigo-600" />Asignar presupuesto sin detalle</label>
        {assigned ? <label className="block text-sm font-semibold">Presupuesto asignado (ARS)<input autoFocus={!create} inputMode="decimal" value={value} onChange={e => setValue(e.target.value)} required disabled={busy} aria-invalid={invalid} className="mt-2 w-full rounded-lg border p-3 font-normal" placeholder="Ej.: 1.500.000" />
          {minimum > 0 && <span className="mt-2 block text-xs font-normal text-slate-500">Ya asignado a subcategorías: ${minimum.toLocaleString('es-AR')}.</span>}
          {invalid && value && <span role="alert" className="mt-2 block text-xs font-normal text-red-600">{budget < minimum ? 'El importe no puede ser menor a lo asignado a las subcategorías.' : 'Ingresá un importe válido, mayor o igual a cero.'}</span>}</label>
          : <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600"><p>Se usará el total de las partidas: ${detailedBudget.toLocaleString('es-AR')}.</p>{invalid && <p role="alert" className="mt-2 text-red-600">Ese total es menor a lo asignado a las subcategorías. Conservá o ajustá el presupuesto global.</p>}</div>}
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-3"><button type="button" onClick={onClose} disabled={busy} className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
          <button type="submit" disabled={busy || invalid || !name.trim()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40">{busy ? 'Guardando…' : create ? 'Crear categoría' : 'Guardar presupuesto'}</button></div>
      </form>
  </dialog>;
}

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { handleDialogCancel } from '../lib/dialogCancel';

// Keep the panel mounted while hidden: closing the window must not discard a
// draft or change the idempotency key of an operation awaiting confirmation.
export function ProviderFinanceWindow({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) { dialog.current?.close(); return; }
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); previous?.focus(); };
  }, [open]);
  return <dialog ref={dialog} aria-label="Asignar documentos y pagos" onCancel={event => handleDialogCancel(event, onClose)}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-5xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-2xl backdrop:bg-slate-950/40">
    <header className="mb-3 flex items-center justify-between gap-3"><h2 className="text-base font-bold">Asignar documentos y pagos</h2>
      <button type="button" onClick={onClose} aria-label="Cerrar asignación" className="rounded p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button></header>
    {children}
  </dialog>;
}

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { handleDialogCancel } from '../../lib/dialogCancel';

export function ProjectDialog({ title, onClose, children, wide = false, actions }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; actions?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => { ref.current?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} aria-label={title} onCancel={event => handleDialogCancel(event, onClose)}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    className={`m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] ${wide ? 'max-w-7xl' : 'max-w-3xl'} overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl backdrop:bg-slate-950/40 sm:p-6`}>
    <header className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="min-w-0 flex-1 text-base font-bold">{title}</h2>{actions}
      <button type="button" onClick={onClose} aria-label="Cerrar ventana" className="rounded p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button></header>
    {children}
  </dialog>;
}

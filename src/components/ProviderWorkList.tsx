import { ChevronRight } from 'lucide-react';

export type PortalWork = {
  key: string; projectId?: string; projectName?: string; description?: string; area?: string;
  currency?: string; total: number; paid: number; markedPaidWithoutDetails?: boolean;
  payments?: { id: string; amount: number; date?: string; detail?: string }[];
};
type Amounts = { currency: string; total: number; paid: number; balance: number; withoutDetails: boolean };
const cents = (value: number) => Math.round((Number(value) || 0) * 100);
const currencyOf = (work: PortalWork) => work.currency || 'ARS';
export const workBalance = (work: PortalWork) => Math.max(0, cents(work.total) - cents(work.paid)) / 100;
const money = (value: number, currency: string) => new Intl.NumberFormat('es-AR', {
  style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2,
}).format(value);

export function groupPortalWorks(works: PortalWork[]) {
  const projects = new Map<string, { id: string; name: string; works: PortalWork[]; amounts: Amounts[] }>();
  for (const work of works) {
    const id = work.projectId || work.key.split('/')[0];
    if (!projects.has(id)) projects.set(id, { id, name: work.projectName || 'Proyecto sin nombre', works: [], amounts: [] });
    const project = projects.get(id)!;
    project.works.push(work);
    const currency = currencyOf(work);
    let amounts = project.amounts.find(amount => amount.currency === currency);
    if (!amounts) { amounts = { currency, total: 0, paid: 0, balance: 0, withoutDetails: false }; project.amounts.push(amounts); }
    amounts.total += cents(work.total);
    amounts.paid += cents(work.paid);
    // An overpayment on one work must not hide another work's outstanding amount.
    amounts.balance += Math.max(0, cents(work.total) - cents(work.paid));
    amounts.withoutDetails ||= work.markedPaidWithoutDetails === true;
  }
  return [...projects.values()].map(project => ({ ...project, amounts: project.amounts.map(amount => ({ ...amount,
    total: amount.total / 100, paid: amount.paid / 100, balance: amount.balance / 100,
  })) }));
}

function WorkAmounts({ amounts }: { amounts: Amounts }) {
  return <dl className="grid min-w-0 grid-cols-3 gap-x-3 text-[11px] tabular-nums lg:flex lg:gap-x-4 lg:text-xs">
    {[{ label: 'Trabajado', value: money(amounts.total, amounts.currency), color: 'text-slate-700' },
      { label: 'Pagado', value: amounts.withoutDetails ? 'Sin detalle' : money(amounts.paid, amounts.currency), color: amounts.withoutDetails ? 'text-amber-700' : 'text-emerald-700' },
      { label: 'Saldo', value: amounts.withoutDetails ? 'Sin detalle' : money(amounts.balance, amounts.currency), color: amounts.withoutDetails ? 'text-amber-700' : amounts.balance > 0 ? 'text-rose-600' : 'text-emerald-700' },
    ].map(field => <div key={field.label} className="min-w-0 lg:whitespace-nowrap"><dt className="text-[10px] text-slate-500 lg:mr-1 lg:inline">{field.label}</dt><dd className={`break-words font-semibold lg:inline ${field.color}`}>{field.value}</dd></div>)}
  </dl>;
}

export function ProviderWorkList({ works, emptyMessage = 'Todavía no tenés trabajos asignados.' }: { key?: string; works: PortalWork[]; emptyMessage?: string }) {
  const projects = groupPortalWorks(works);
  return <section aria-label="Trabajos por proyecto" className="overflow-hidden rounded-xl border border-slate-200 bg-white">
    <header className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500"><h3 className="font-semibold">Proyectos</h3><span className="text-[10px]">{projects.length} {projects.length === 1 ? 'proyecto' : 'proyectos'}</span></header>
    {!projects.length ? <p className="px-3 py-4 text-sm text-slate-500">{emptyMessage}</p> : <div className="divide-y divide-slate-200">{projects.map(project => <details key={project.id} className="group/work-project">
      <summary className="grid min-h-10 cursor-pointer list-none gap-2 bg-slate-50/80 px-3 py-2 transition-colors hover:bg-indigo-50 lg:flex lg:items-center lg:justify-between lg:gap-4 lg:py-1.5 [&::-webkit-details-marker]:hidden">
        <div className="flex min-w-0 items-center gap-2"><ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-indigo-500 transition-transform group-open/work-project:rotate-90" /><span className="min-w-0 break-words text-xs font-semibold text-slate-900">{project.name}</span><span className="shrink-0 rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-500">{project.works.length} {project.works.length === 1 ? 'trabajo' : 'trabajos'}</span></div>
        <div className="min-w-0 space-y-1">{project.amounts.map(amount => <div key={amount.currency} className="min-w-0">{project.amounts.length > 1 && <p className="mb-0.5 text-[9px] font-semibold text-slate-500 lg:text-right">{amount.currency}</p>}<WorkAmounts amounts={amount} /></div>)}</div>
      </summary>
      <div className="divide-y divide-slate-100 border-t border-slate-200">{project.works.map(work => <article key={work.key} className="grid gap-2 px-3 py-2.5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:gap-4">
        <div className="min-w-0"><p className="break-words text-xs font-medium text-slate-800">{work.description || 'Sin descripción'}</p>
          {work.area && <span className="mt-1 inline-block rounded bg-indigo-50 px-1.5 py-0.5 text-[9px] font-medium text-indigo-700">{work.area}</span>}
          {work.markedPaidWithoutDetails && <p className="mt-1 text-[10px] text-amber-800">Marcado pagado; sin detalle cargado.</p>}
          {!!work.payments?.length && <details className="mt-1 text-[11px] text-slate-500"><summary className="cursor-pointer rounded py-1 transition-colors hover:text-indigo-700">{work.payments.length === 1 ? 'Ver pago' : `Ver ${work.payments.length} pagos`}</summary><ul className="mt-1 space-y-1">{work.payments.map(payment => <li key={payment.id} className="break-words"><b className="font-medium text-emerald-700">{money(payment.amount, currencyOf(work))}</b>{/^\d{4}-\d{2}-\d{2}/.test(payment.date || '') && <span> · {payment.date!.slice(0, 10).split('-').reverse().join('/')}</span>}{payment.detail && <span> · {payment.detail}</span>}</li>)}</ul></details>}
        </div>
        <WorkAmounts amounts={{ currency: currencyOf(work), total: work.total, paid: work.paid, balance: workBalance(work), withoutDetails: !!work.markedPaidWithoutDetails }} />
      </article>)}</div>
    </details>)}</div>}
  </section>;
}

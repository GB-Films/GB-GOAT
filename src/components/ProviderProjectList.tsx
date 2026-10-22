import { ChevronRight, ExternalLink } from 'lucide-react';
import type { ExpenseInvoiceDocument } from '../lib/invoices';
import { ProviderDocumentLinks } from './ProviderDocumentLinks';

interface ProviderProjectSummary {
  id: string;
  name: string;
  total: number;
  paid: number;
  debt: number;
  invoices: number;
  receipts: number;
}

interface ProviderProjectExpense {
  id: string;
  projectId: string;
  area: string;
  source: string;
  description: string;
  total: number;
  paid: number;
  debt: number;
  paymentDate?: unknown;
  payments: { id: string | number; amount: number; date?: unknown; loadedBy?: string; detail?: string }[];
  invoiceDocuments?: ExpenseInvoiceDocument[];
  otherReceiptDocuments?: ExpenseInvoiceDocument[];
  paymentReceiptDocuments?: ExpenseInvoiceDocument[];
}

const money = (value: number) => `$${value.toLocaleString('es-AR')}`;
const date = (value: unknown): string => {
  if (typeof value === 'string') {
    const key = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return key ? `${key[3]}/${key[2]}/${key[1]}` : value || 'Sin fecha';
  }
  try {
    let parsed: Date | undefined;
    if (value instanceof Date) parsed = value;
    else if (typeof value === 'number') parsed = new Date(value);
    else if (value && typeof value === 'object') {
      if ('seconds' in value && typeof value.seconds === 'number') parsed = new Date(value.seconds * 1000);
      else if ('toDate' in value && typeof value.toDate === 'function') parsed = value.toDate();
    }
    return parsed instanceof Date && Number.isFinite(parsed.getTime())
      ? parsed.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : 'Sin fecha';
  } catch {
    return 'Sin fecha';
  }
};

function Amounts({ total, paid, debt }: { total: number; paid: number; debt: number }) {
  return <div className="grid grid-cols-3 gap-3 text-right tabular-nums">
    <div><span className="block text-[9px] font-bold uppercase tracking-wide text-slate-400">Trabajado</span><span className="text-xs font-bold text-slate-600">{money(total)}</span></div>
    <div><span className="block text-[9px] font-bold uppercase tracking-wide text-slate-400">Pagado</span><span className="text-xs font-bold text-emerald-600">{money(paid)}</span></div>
    <div><span className="block text-[9px] font-bold uppercase tracking-wide text-slate-400">Deuda</span><span className={`text-xs font-black ${debt > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{money(debt)}</span></div>
  </div>;
}

export function ProviderProjectList({ projects, lines }: { projects: ProviderProjectSummary[]; lines: ProviderProjectExpense[] }) {
  const byProject = new Map<string, ProviderProjectExpense[]>();
  for (const line of lines) {
    const group = byProject.get(line.projectId) || [];
    group.push(line);
    byProject.set(line.projectId, group);
  }
  return <section className="overflow-hidden rounded-xl border border-slate-200" aria-label="Proyectos del proveedor">
    <h3 className="bg-slate-50 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Proyectos</h3>
    {projects.length === 0 ? <div className="p-8 text-center text-xs text-slate-400">Sin movimientos visibles</div> :
      <div className="divide-y divide-slate-200">
        {projects.map(project => {
          const expenses = byProject.get(project.id) || [];
          return <details key={project.id} className="group/project">
            <summary className="flex cursor-pointer list-none flex-col gap-3 px-4 py-4 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-500 md:flex-row md:items-center md:justify-between [&::-webkit-details-marker]:hidden">
              <div className="flex min-w-0 items-center gap-3">
                <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 group-open/project:rotate-90" />
                <div className="min-w-0">
                  <div className="break-words text-xs font-black text-slate-900">{project.name}</div>
                  <div className="mt-1 text-[10px] text-slate-500">{expenses.length} {expenses.length === 1 ? 'gasto' : 'gastos'} · {project.invoices} {project.invoices === 1 ? 'factura' : 'facturas'} · {project.receipts} {project.receipts === 1 ? 'comprobante' : 'comprobantes'}</div>
                </div>
              </div>
              <div className="md:w-[360px] md:shrink-0"><Amounts {...project} /></div>
            </summary>
            <div className="border-t border-slate-100 bg-slate-50/60 p-3 md:p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Gastos y pagos</span>
                <a href={`#/proyectos/${project.id}`} className="inline-flex shrink-0 items-center gap-1 text-[10px] font-bold text-blue-700 hover:underline">Abrir proyecto <ExternalLink aria-hidden="true" className="h-3 w-3" /></a>
              </div>
              <div className="space-y-3">
                {expenses.map(line => <article key={line.id} className="min-w-0 rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <h4 className="break-words text-xs font-bold text-slate-900">{line.description}</h4>
                      <p className="mt-1 text-[10px] text-slate-500">{line.area} · {line.source}</p>
                      {!!line.paymentDate && !line.payments.length && !line.paid && <p className="mt-1 text-[10px] text-slate-500">Fecha prevista: {date(line.paymentDate)}</p>}
                    </div>
                    {expenses.length > 1 && <div className="md:w-[360px] md:shrink-0"><Amounts {...line} /></div>}
                  </div>
                  {line.payments.length > 0 && <div className="mt-3 border-t border-slate-100 pt-3">
                    <h5 className="mb-2 text-[9px] font-bold uppercase tracking-widest text-slate-500">Pagos registrados</h5>
                    <ul className="space-y-2">{line.payments.map(payment => <li key={payment.id} className="break-words text-[11px] text-slate-600">
                      <span className="font-bold text-emerald-700">{money(payment.amount)}</span>
                      {!!payment.date && <span> · {date(payment.date)}</span>}
                      <span> · {payment.loadedBy ? `Cargado por ${payment.loadedBy}` : 'Autor no registrado'}</span>
                      {payment.detail && <div className="mt-1 text-slate-500">{payment.detail}</div>}
                    </li>)}</ul>
                  </div>}
                  <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-3">
                    {([
                      { label: 'Facturas', documents: line.invoiceDocuments, kind: 'invoice' },
                      { label: 'Otros comprobantes', documents: line.otherReceiptDocuments, kind: 'other' },
                      { label: 'Comprobantes de pago', documents: line.paymentReceiptDocuments, kind: 'payment' },
                    ] as const).map(group => <div key={group.kind}>
                      <div className="mb-2 text-center text-[9px] font-bold uppercase tracking-wide text-slate-500">{group.label}</div>
                      <ProviderDocumentLinks documents={group.documents} kind={group.kind} />
                    </div>)}
                  </div>
                </article>)}
                {!expenses.length && <p className="text-xs text-slate-500">Sin detalle de gastos disponible.</p>}
              </div>
            </div>
          </details>;
        })}
      </div>}
  </section>;
}

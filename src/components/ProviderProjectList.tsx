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
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-right text-xs tabular-nums">
    <span className="text-slate-500">Trabajado <b className="text-slate-700">{money(total)}</b></span>
    <span className="text-slate-500">Pagado <b className="text-emerald-600">{money(paid)}</b></span>
    <span className="text-slate-500">Saldo <b className={debt > 0 ? 'text-rose-600' : 'text-emerald-600'}>{money(debt)}</b></span>
  </div>;
}

export function ProviderProjectList({ projects, lines }: { projects: ProviderProjectSummary[]; lines: ProviderProjectExpense[] }) {
  const byProject = new Map<string, ProviderProjectExpense[]>();
  for (const line of lines) byProject.set(line.projectId, [...(byProject.get(line.projectId) || []), line]);
  return <section className="overflow-hidden rounded-xl border border-slate-200" aria-label="Proyectos del proveedor">
    <h3 className="bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">Proyectos</h3>
    {projects.length === 0 ? <div className="p-6 text-center text-xs text-slate-400">Sin movimientos visibles</div> : <div className="divide-y divide-slate-200">
      {projects.map(project => {
        const expenses = byProject.get(project.id) || [];
        return <details key={project.id} className="group/project">
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-500 [&::-webkit-details-marker]:hidden">
            <div className="flex min-w-0 items-center gap-2"><ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-slate-400 group-open/project:rotate-90" />
              <span className="text-xs font-bold text-slate-900">{project.name}</span><span className="text-[10px] text-slate-400">{expenses.length} mov.</span></div>
            <Amounts {...project} />
          </summary>
          <div className="border-t border-slate-100">
            <div className="flex justify-end px-3 py-1.5"><a href={`#/proyectos/${project.id}`} className="inline-flex items-center gap-1 text-[11px] text-blue-700 hover:underline">Abrir proyecto<ExternalLink aria-hidden="true" className="h-3 w-3" /></a></div>
            <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-xs">
              <thead className="border-b border-slate-100 bg-slate-50 text-[10px] font-medium text-slate-500"><tr>
                <th className="px-3 py-2">Movimiento</th>{expenses.length > 1 && <><th className="px-3 py-2 text-right">Importe</th><th className="px-3 py-2 text-right">Pagado</th><th className="px-3 py-2 text-right">Saldo</th></>}<th className="px-3 py-2">Comprobantes</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">{expenses.map(line => {
                const hasDocuments = !!(line.invoiceDocuments?.length || line.otherReceiptDocuments?.length || line.paymentReceiptDocuments?.length);
                return <tr key={line.id} className="align-top hover:bg-slate-50/50">
                  <td className="px-3 py-2"><div className="max-w-lg truncate font-medium text-slate-900" title={`${line.description} · ${line.area} · ${line.source}`}>{line.description}</div>
                    {!!line.paymentDate && !line.payments.length && !line.paid && <span className="text-[10px] text-slate-500">Fecha prevista: {date(line.paymentDate)}</span>}
                    {line.payments.length > 0 && <details className="mt-1 text-[10px] text-slate-500"><summary className="cursor-pointer hover:text-slate-900">{line.payments.length === 1 ? 'Ver pago' : `Ver ${line.payments.length} pagos`}</summary>
                      <ul className="mt-1 space-y-1">{line.payments.map(payment => <li key={payment.id}>
                        <b className="text-emerald-700">{money(payment.amount)}</b> · {date(payment.date)}
                        {payment.loadedBy && <span> · {payment.loadedBy}</span>}{payment.detail && <span> · {payment.detail}</span>}
                      </li>)}</ul>
                    </details>}
                  </td>
                  {expenses.length > 1 && <><td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(line.total)}</td><td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-emerald-600">{money(line.paid)}</td><td className={`whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums ${line.debt > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{money(line.debt)}</td></>}
                  <td className="px-3 py-2"><div className="flex flex-wrap gap-1">
                    {!!line.invoiceDocuments?.length && <ProviderDocumentLinks documents={line.invoiceDocuments} kind="invoice" compact invoicePayment={line} />}
                    {!!line.otherReceiptDocuments?.length && <ProviderDocumentLinks documents={line.otherReceiptDocuments} kind="other" compact />}
                    {!!line.paymentReceiptDocuments?.length && <ProviderDocumentLinks documents={line.paymentReceiptDocuments} kind="payment" compact />}
                    {!hasDocuments && <span className="text-[10px] text-slate-400">Sin comprobantes</span>}
                  </div></td>
                </tr>;
              })}</tbody>
            </table></div>
            {!expenses.length && <p className="px-3 py-2 text-xs text-slate-500">Sin detalle de gastos disponible.</p>}
          </div>
        </details>;
      })}
    </div>}
  </section>;
}

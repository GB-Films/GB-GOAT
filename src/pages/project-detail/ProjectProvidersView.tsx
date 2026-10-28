import { lazy, Suspense, useState } from 'react';
import React from 'react';
import { FileText, Paperclip } from 'lucide-react';
import { cn } from '../../lib/utils';
import { formatIdentifier } from '../../lib/providerConstants';
import { invoicePaymentAppearance, type ProviderPaymentStatus } from '../../lib/providerPaymentStatus';
import type { PaymentCollection } from './types';
import type { ExpenseInvoiceDocument } from '../../lib/invoices';
const ProviderProfileDialog = lazy(() => import('../../components/ProviderProfileDialog'));

export type ProviderBalanceEntry = {
  id: string; collectionName: PaymentCollection; item: any; description: string; total: number; paid: number;
  invoices: ExpenseInvoiceDocument[]; otherReceipts?: any[];
};
export type ProjectProviderBalance = {
  id: string; provider: any | null; area: string; name: string; cuit: string; cbu: string;
  budgeted: number; spent: number; paid: number; debt: number; entries: ProviderBalanceEntry[];
};
function ProviderName({ saldo, onOpen }: { saldo: ProjectProviderBalance; onOpen: (provider: any) => void }) {
  return saldo.provider ? <button type="button" onClick={() => onOpen(saldo.provider)} title="Ver ficha y comprobantes"
    className="text-left text-xs font-bold uppercase text-slate-900 underline decoration-slate-300 underline-offset-4 hover:text-blue-600">{saldo.name}</button>
    : <span className="text-xs font-bold uppercase text-slate-900">{saldo.name}</span>;
}
function EntryActions({ entry, canManage, onPayment }: { entry: ProviderBalanceEntry; canManage: boolean; onPayment: (item: any, collection: PaymentCollection) => void }) {
  const appearance = invoicePaymentAppearance(entry.total, entry.paid);
  const receipts = Array.isArray(entry.item?.paymentHistory) ? entry.item.paymentHistory : [];
  const actionClass = 'inline-flex items-center gap-1 rounded border px-2 py-1 text-[10px] font-bold uppercase tracking-widest';
  return <div className="flex flex-wrap items-center gap-1.5">
    {entry.invoices.filter(invoice => invoice.url).map((invoice, index) => <a key={invoice.id || invoice.path || invoice.url || index} href={invoice.url} target="_blank" rel="noreferrer"
      title={`${appearance.label} · ${invoice.fileName || invoice.originalFileName || 'Ver factura'}`} aria-label={`${appearance.label}: ${invoice.fileName || invoice.originalFileName || 'Factura'}`}
      className={cn(actionClass, appearance.className)}><FileText className="h-3 w-3" />Factura{entry.invoices.length > 1 ? ` ${index + 1}` : ''}</a>)}
    {receipts.filter((payment: any) => payment.receipt?.url).map((payment: any, index: number) => <a key={payment.id || index} href={payment.receipt.url} target="_blank" rel="noreferrer"
      title={payment.receipt.originalFileName || 'Ver comprobante de pago'} className={cn(actionClass, 'border-blue-100 bg-blue-50 text-blue-700 hover:bg-blue-100')}><Paperclip className="h-3 w-3" />Comp.</a>)}
    {(entry.otherReceipts || []).filter(receipt => receipt?.url).map((receipt, index) => <a key={receipt.id || receipt.path || index} href={receipt.url} target="_blank" rel="noreferrer"
      title={receipt.originalFileName || 'Ver otro comprobante'} className={cn(actionClass, 'border-sky-100 bg-sky-50 text-sky-700 hover:bg-sky-100')}><Paperclip className="h-3 w-3" />Otro comp.</a>)}
    {canManage && <button type="button" onClick={() => onPayment(entry.item, entry.collectionName)} className={cn(actionClass, 'border-slate-200 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-900')}>
      {entry.total - entry.paid > 0.01 ? 'Registrar pago' : 'Ver pagos'}
    </button>}
  </div>;
}

export function ProjectProvidersView({ groups, totalRows, search, onSearchChange, status, onStatusChange, isProjectAdmin, canManagePaymentForItem, openPaymentModal, formatDate, paymentTiming, onOpenProvider }: {
  groups: Array<{ area: string; rows: ProjectProviderBalance[] }>; totalRows: number;
  search: string; onSearchChange: (value: string) => void; status: ProviderPaymentStatus | 'all'; onStatusChange: (value: ProviderPaymentStatus | 'all') => void;
  isProjectAdmin: boolean; canManagePaymentForItem: (item: any, collection: PaymentCollection) => boolean;
  openPaymentModal: (item: any, collection: PaymentCollection) => void; formatDate: (date: any) => string; paymentTiming: (date: any) => string;
  onOpenProvider?: (provider: any) => void;
}) {
  const [selectedProvider, setSelectedProvider] = useState<any | null>(null);
  const [copiedPaymentLineId, setCopiedPaymentLineId] = useState<string | null>(null);
  const visibleRows = groups.reduce((count, group) => count + group.rows.length, 0);
  return <div className="space-y-4 pb-20">
    <header className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <h2 className="text-base font-bold text-slate-900">Proveedores</h2><span className="text-xs text-slate-500">{visibleRows} con movimientos</span>
    </header>
    <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-[minmax(0,1fr)_220px]">
      <label className="block text-xs font-medium text-slate-500">Buscar proveedor
        <input aria-label="Buscar proveedor" value={search} onChange={event => onSearchChange(event.target.value)} placeholder="Nombre o razón social"
          className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none" />
      </label>
      <label className="block text-xs font-medium text-slate-500">Estado de pago
        <select aria-label="Estado de pago" value={status} onChange={event => onStatusChange(event.target.value as ProviderPaymentStatus | 'all')}
          className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none">
          <option value="all">Todos</option><option value="pendiente">Pendiente</option><option value="parcial">Parcial</option><option value="pagado">Pagado</option>
        </select>
      </label>
    </div>
            <div className="space-y-2 md:hidden">
              {groups.map((group) => (
                <section key={`mobile-${group.area}`} className="rounded-lg border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-slate-500">
                    {group.area}
                  </div>
                  <div className="divide-y divide-slate-100">
                    {group.rows.map((saldo) => (
                      <div key={`mobile-${saldo.id}`} className="p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <ProviderName saldo={saldo} onOpen={onOpenProvider || setSelectedProvider} />
                            <div className="mt-0.5 text-[9px] font-mono font-bold text-slate-400">
                              {isProjectAdmin ? saldo.cbu || 'Sin CBU' : 'Cuenta disponible para admins'}
                            </div>
                            {saldo.cuit && (
                              <button
                                type="button"
                                onClick={() => {
                                  void navigator.clipboard?.writeText(saldo.cuit);
                                  setCopiedPaymentLineId(`saldo-cuit-${saldo.id}`);
                                  window.setTimeout(() => setCopiedPaymentLineId(null), 1800);
                                }}
                                className="mt-1 rounded border border-slate-100 bg-slate-50 px-1.5 py-1 text-[8px] font-black uppercase tracking-widest text-slate-500"
                              >
                                {copiedPaymentLineId === `saldo-cuit-${saldo.id}` ? 'CUIT copiado' : `CUIT ${formatIdentifier(saldo.cuit)}`}
                              </button>
                            )}
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-[8px] font-black uppercase tracking-widest text-slate-300">Debe</div>
                            <div className={cn("font-mono text-xs font-black", saldo.debt > 0 ? "text-rose-600" : "text-emerald-600")}>
                              ${saldo.debt.toLocaleString()}
                            </div>
                          </div>
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-1.5">
                          <div className="rounded bg-slate-50 px-2 py-1">
                            <div className="text-[7px] font-black uppercase tracking-widest text-slate-300">Gastado</div>
                            <div className="truncate font-mono text-[10px] font-bold text-slate-700">${saldo.spent.toLocaleString()}</div>
                          </div>
                          <div className="rounded bg-emerald-50 px-2 py-1">
                            <div className="text-[7px] font-black uppercase tracking-widest text-emerald-400">Pagado</div>
                            <div className="truncate font-mono text-[10px] font-bold text-emerald-700">${saldo.paid.toLocaleString()}</div>
                          </div>
                          <div className="rounded bg-slate-50 px-2 py-1">
                            <div className="text-[7px] font-black uppercase tracking-widest text-slate-300">Items</div>
                            <div className="font-mono text-[10px] font-bold text-slate-700">{saldo.entries.length}</div>
                          </div>
                        </div>
                        <div className="mt-2 space-y-1">
                          {saldo.entries.map((entry) => {

                            return (
                              <div key={`mobile-${entry.collectionName}-${entry.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-100 bg-slate-50 px-2 py-1.5">
                                <div className="min-w-0">
                                  <div className="truncate text-[10px] font-bold text-slate-700">{entry.description || 'Movimiento'}</div>
                                  {entry.item?.paymentDate && (
                                    <div className="text-[8px] font-black uppercase tracking-widest text-slate-400">Pago {formatDate(entry.item.paymentDate)}</div>
                                  )}
                                </div>
                                <EntryActions entry={entry} canManage={canManagePaymentForItem(entry.item, entry.collectionName)} onPayment={openPaymentModal} />
                              </div>
                            );
                          })}

                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
              {totalRows === 0 && (
                <div className="rounded-lg border border-dashed border-slate-200 bg-white p-6 text-center text-[10px] font-bold uppercase tracking-widest text-slate-300">
                  No hay movimientos financieros
                </div>
              )}
              {totalRows > 0 && visibleRows === 0 && (
                <div className="rounded-lg border border-dashed border-slate-200 bg-white p-6 text-center text-[10px] font-bold uppercase tracking-widest text-slate-300">
                  No hay movimientos que coincidan con los filtros
                </div>
              )}
            </div>

            <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm md:block">
               <table className="w-full min-w-[1000px] text-left">
                 <thead>
                   <tr className="bg-slate-50 border-b border-slate-200">
                     <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Proveedor</th>
                     <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Cuenta</th>
                     <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-right">Presupuesto</th>
                     <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-right">Gastado</th>
                     <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-right">Pagado</th>
                     <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-right">Deuda</th>
                     <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Documentos / Pagos</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-100">
                   {groups.map((group) => (
                     <React.Fragment key={group.area}>
                       <tr className="bg-slate-100/70">
                         <td colSpan={7} className="px-6 py-3 text-[9px] font-black uppercase tracking-[0.16em] text-slate-500">
                           {group.area}
                         </td>
                       </tr>
                       {group.rows.map((saldo) => (
                         <tr key={saldo.id} className="hover:bg-slate-50/50 transition-colors group">
                           <td className="px-6 py-4">
                             <ProviderName saldo={saldo} onOpen={onOpenProvider || setSelectedProvider} />
                           </td>
                           <td className="px-6 py-4">
                             <div className="space-y-1">
                               <div className="text-[10px] font-mono text-slate-500 bg-slate-50 px-2 py-1 rounded inline-block border border-slate-100">
                                 {isProjectAdmin ? saldo.cbu : 'Disponible para admins'}
                               </div>
                               {saldo.cuit && (
                                 <button
                                   type="button"
                                   onClick={() => {
                                     void navigator.clipboard?.writeText(saldo.cuit);
                                     setCopiedPaymentLineId(`saldo-cuit-${saldo.id}`);
                                     window.setTimeout(() => setCopiedPaymentLineId(null), 1800);
                                   }}
                                   className="block rounded border border-slate-100 bg-white px-2 py-1 text-[9px] font-black uppercase tracking-widest text-slate-500 hover:border-black hover:text-black"
                                 >
                                   {copiedPaymentLineId === `saldo-cuit-${saldo.id}` ? 'CUIT copiado' : `CUIT ${formatIdentifier(saldo.cuit)}`}
                                 </button>
                               )}
                             </div>
                           </td>
                           <td className="px-6 py-4 text-right text-xs font-medium text-slate-400">
                             ${saldo.budgeted.toLocaleString()}
                           </td>
                           <td className="px-6 py-4 text-right text-xs font-medium text-slate-600">
                             ${saldo.spent.toLocaleString()}
                           </td>
                           <td className="px-6 py-4 text-right text-xs font-medium text-emerald-600">
                             ${saldo.paid.toLocaleString()}
                           </td>
                           <td className="px-6 py-4 text-right">
                             <div className={cn(
                               "text-sm font-bold font-mono",
                               saldo.debt > 0 ? "text-rose-600" : "text-emerald-600"
                             )}>
                           ${saldo.debt.toLocaleString()}
                         </div>
                       </td>
                       <td className="px-6 py-4">
                         <div className="space-y-2">
                           {saldo.entries.map((entry) => {

                             return (
                               <div key={`${entry.collectionName}-${entry.id}`} className="flex flex-wrap items-center gap-2 text-[10px]">
                                 <span className="max-w-[170px] truncate text-slate-500" title={entry.description}>
                                   {entry.description || 'Movimiento'}
                                 </span>
                                 {entry.item?.paymentDate && (
                                   <span className="px-2 py-1 rounded bg-slate-50 border border-slate-100 text-slate-500 font-bold uppercase tracking-widest">
                                     Pago {formatDate(entry.item.paymentDate)} · {paymentTiming(entry.item.paymentDate)}
                                   </span>
                                 )}
                                 <EntryActions entry={entry} canManage={canManagePaymentForItem(entry.item, entry.collectionName)} onPayment={openPaymentModal} />
                               </div>
                             );
                           })}
                         </div>
                       </td>
                     </tr>
                   ))}
                     </React.Fragment>
                   ))}
                   {totalRows === 0 && (
                     <tr>
                       <td colSpan={7} className="px-6 py-12 text-center text-[10px] font-bold uppercase text-slate-300 tracking-widest italic">
                         No hay movimientos financieros con proveedores registrados
                       </td>
                     </tr>
                   )}
                   {totalRows > 0 && visibleRows === 0 && (
                     <tr>
                       <td colSpan={7} className="px-6 py-12 text-center text-[10px] font-bold uppercase text-slate-300 tracking-widest italic">
                         No hay movimientos que coincidan con los filtros
                       </td>
                     </tr>
                   )}
                 </tbody>
               </table>
            </div>

    {selectedProvider && <Suspense fallback={<p role="status" className="text-sm text-slate-500">Cargando ficha y comprobantes…</p>}><ProviderProfileDialog provider={selectedProvider} onClose={() => setSelectedProvider(null)} /></Suspense>}
  </div>;
}

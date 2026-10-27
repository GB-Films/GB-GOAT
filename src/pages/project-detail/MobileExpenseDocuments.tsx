import { handlePortalInvoiceLink } from '../../lib/portalInvoiceLink';
import { useState } from 'react';
import { FileText, Link, Paperclip, Trash2 } from 'lucide-react';
import { getExpenseInvoices, getInvoiceDocumentKey, type ExpenseInvoiceDocument } from '../../lib/invoices';
import { ProjectDialog } from './ProjectDialog';
import { INVOICE_INPUT_ACCEPT, RECEIPT_INPUT_ACCEPT } from './ExpenseFileCells';

export type MobileExpenseDocumentsProps = {
  item: any;
  canManage: boolean;
  canRemove: boolean;
  uploadingInvoice: boolean;
  uploadingReceipt: boolean;
  generatingLink: boolean;
  onUploadInvoice: (file?: File | null) => void;
  onUploadReceipt: (file?: File | null) => void;
  onRemoveInvoice: (invoice: ExpenseInvoiceDocument) => void;
  onRemoveReceipt: (receipt: any) => void;
  onCreateInvoiceLink: () => void;
};

export function ExpenseDocumentsPanel(props: MobileExpenseDocumentsProps) {
  const { item, canManage, canRemove, uploadingInvoice, uploadingReceipt, generatingLink } = props;
  const invoices = getExpenseInvoices(item);
  const receipts = Array.isArray(item.otherReceipts) ? item.otherReceipts.filter((receipt: any) => receipt?.url) : [];
  const payments = Array.isArray(item.paymentHistory) ? item.paymentHistory.filter((payment: any) => payment?.receipt?.url) : [];
  const renderDocument = (document: any, key: string, fallback: string, onRemove?: () => void, busy?: boolean) => (
    <div key={key} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
      <FileText className="h-5 w-5 shrink-0 text-slate-400" />
      <a href={document.url || '#'} onClick={e=>handlePortalInvoiceLink(e,document)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 break-words text-xs font-bold text-blue-700 underline underline-offset-2">
        {document.originalFileName || document.fileName || fallback}
      </a>
      {onRemove && <button type="button" disabled={busy} onClick={onRemove}
        aria-label={`Eliminar ${document.originalFileName || document.fileName || fallback}`}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600 disabled:opacity-40">
        <Trash2 className="h-4 w-4" />
      </button>}
    </div>
  );
  const upload = (kind: 'invoice' | 'receipt') => {
    const busy = kind === 'invoice' ? uploadingInvoice : uploadingReceipt;
    return <label className={`flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs font-bold ${busy ? 'opacity-50' : 'cursor-pointer'}`}>
      <Paperclip className="h-4 w-4" />
      {busy ? 'Subiendo…' : kind === 'invoice' ? 'Cargar factura' : 'Cargar otro comprobante'}
      <input type="file" accept={kind === 'invoice' ? INVOICE_INPUT_ACCEPT : RECEIPT_INPUT_ACCEPT}
        className="sr-only" disabled={busy} onChange={event => {
          (kind === 'invoice' ? props.onUploadInvoice : props.onUploadReceipt)(event.target.files?.[0]);
          event.target.value = '';
        }} />
    </label>;
  };
  return <div className="space-y-5">
    <p className="break-words text-xs text-slate-500">{item.providerName || item.description || 'Documentación del gasto'}</p>
    <section className="space-y-2">
      <h3 className="text-xs font-black uppercase tracking-wide text-slate-600">Facturas</h3>
      {invoices.map((invoice, index) => renderDocument(invoice, getInvoiceDocumentKey(invoice) || String(index), `Factura ${index + 1}`,
        canRemove ? () => props.onRemoveInvoice(invoice) : undefined, uploadingInvoice))}
      {!invoices.length && <p className="text-xs text-slate-400">Sin facturas cargadas.</p>}
      {canManage && <>
        {upload('invoice')}
        <button type="button" onClick={props.onCreateInvoiceLink} disabled={generatingLink}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-50 p-3 text-xs font-bold text-blue-700 disabled:opacity-40">
          <Link className="h-4 w-4" />{generatingLink ? 'Generando link…' : 'Copiar link de carga para el proveedor'}
        </button>
      </>}
    </section>
    <section className="space-y-2">
      <h3 className="text-xs font-black uppercase tracking-wide text-slate-600">Otros comprobantes</h3>
      {receipts.map((receipt: any, index: number) => renderDocument(receipt, receipt.id || receipt.path || String(index), `Comprobante ${index + 1}`,
        canRemove ? () => props.onRemoveReceipt(receipt) : undefined, uploadingReceipt))}
      {!receipts.length && <p className="text-xs text-slate-400">Sin otros comprobantes cargados.</p>}
      {canManage && upload('receipt')}
    </section>
    {payments.length > 0 && <section className="space-y-2">
      <h3 className="text-xs font-black uppercase tracking-wide text-slate-600">Comprobantes de pagos</h3>
      {payments.map((payment: any, index: number) => renderDocument(payment.receipt, payment.id || String(index), `Pago ${index + 1}`))}
      <p className="text-xs text-slate-500">Los comprobantes asociados a pagos se gestionan desde Pagos.</p>
    </section>}
  </div>;
}

export function MobileExpenseDocuments(props: MobileExpenseDocumentsProps) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}
      className="inline-flex h-8 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[9px] font-black uppercase tracking-wide text-slate-600">
      <Paperclip className="h-3 w-3" />Comprobantes
    </button>
    {open && <ProjectDialog title="Comprobantes del gasto" onClose={() => setOpen(false)}>
      <ExpenseDocumentsPanel {...props} />
    </ProjectDialog>}
  </>;
}

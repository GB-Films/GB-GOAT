import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Link as LinkIcon, Paperclip, Plus, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { getExpenseInvoices, getInvoiceDocumentKey, type ExpenseInvoiceDocument } from '../../lib/invoices';

export const INVOICE_INPUT_ACCEPT = 'application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png';
export const RECEIPT_INPUT_ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp';

type ExpenseInvoiceCellProps = {
  item: any;
  canManage: boolean;
  canRemove: boolean;
  uploadingInvoice: boolean;
  generatingLink: boolean;
  onUploadInvoice: (file?: File | null) => void;
  onRemoveInvoice: (invoice: ExpenseInvoiceDocument) => void;
  onCreateInvoiceLink: () => void;
};

type ExpenseReceiptsCellProps = {
  item: any;
  canManage: boolean;
  uploadingReceipt: boolean;
  onUploadReceipt: (file?: File | null) => void;
  onRemoveReceipt: (receipt: any) => void;
  canRemoveReceipt: (receipt: any) => boolean;
};

export function ExpenseInvoiceCell({
  item,
  canManage,
  canRemove,
  uploadingInvoice,
  generatingLink,
  onUploadInvoice,
  onRemoveInvoice,
  onCreateInvoiceLink,
}: ExpenseInvoiceCellProps) {
  const invoices = getExpenseInvoices(item);
  const [showInvoiceList, setShowInvoiceList] = useState(false);

  useEffect(() => {
    if (invoices.length <= 1) setShowInvoiceList(false);
  }, [invoices.length]);

  const singleInvoice = invoices.length === 1 ? invoices[0] : null;

  return (
    <>
      <div className="flex items-center justify-center gap-1">
      {singleInvoice ? (
        <>
          <a
            href={singleInvoice.url}
            target="_blank"
            rel="noreferrer"
            className="flex h-7 w-7 items-center justify-center rounded border border-emerald-100 bg-emerald-50 text-emerald-600 transition-all hover:bg-emerald-600 hover:text-white"
            title={singleInvoice.fileName || singleInvoice.originalFileName || 'Ver factura'}
          >
            <FileText className="h-3.5 w-3.5" />
          </a>
          {canRemove && (
            <button
              type="button"
              disabled={uploadingInvoice}
              onClick={() => onRemoveInvoice(singleInvoice)}
              className="flex h-7 w-7 items-center justify-center rounded border border-slate-100 bg-white text-slate-300 transition-all hover:border-red-100 hover:text-red-500 disabled:cursor-wait disabled:opacity-50"
              title="Quitar factura"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </>
      ) : invoices.length > 1 ? (
        <button
          type="button"
          onClick={() => setShowInvoiceList(true)}
          className="relative flex h-7 min-w-8 items-center justify-center gap-1 rounded border border-emerald-100 bg-emerald-50 px-1.5 text-emerald-700 transition-all hover:bg-emerald-600 hover:text-white"
          title={`Ver ${invoices.length} facturas`}
        >
          <FileText className="h-3.5 w-3.5" />
          <span className="text-[9px] font-black">{invoices.length}</span>
        </button>
      ) : !canManage ? (
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-300">Sin factura</span>
      ) : null}

      {canManage && (
        <>
          <label
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded border transition-all',
              uploadingInvoice
                ? 'cursor-wait border-slate-200 bg-slate-100 text-slate-300'
                : 'cursor-pointer border-slate-200 bg-white text-slate-400 hover:border-black hover:text-black',
            )}
            title={invoices.length > 0 ? 'Adjuntar otra factura PDF/JPG/PNG' : 'Adjuntar factura PDF/JPG/PNG'}
          >
            <Paperclip className="h-3.5 w-3.5" />
            <input
              type="file"
              accept={INVOICE_INPUT_ACCEPT}
              className="hidden"
              disabled={uploadingInvoice}
              onChange={(event) => {
                onUploadInvoice(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </label>
          <button
            type="button"
            disabled={generatingLink}
            onClick={onCreateInvoiceLink}
            className="flex h-7 w-7 items-center justify-center rounded border border-blue-100 bg-blue-50 text-blue-600 transition-all hover:bg-blue-600 hover:text-white disabled:cursor-wait disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-300"
            title="Copiar link para que el proveedor cargue su factura"
          >
            <LinkIcon className="h-3.5 w-3.5" />
          </button>
        </>
      )}
      </div>

      {showInvoiceList && invoices.length > 1 && createPortal((
        <div
          className="fixed inset-0 z-[520] flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Facturas del gasto"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowInvoiceList(false);
          }}
        >
          <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="text-sm font-black text-slate-900">Facturas del gasto</h3>
                <p className="mt-0.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">{invoices.length} documentos cargados</p>
              </div>
              <button type="button" onClick={() => setShowInvoiceList(false)} className="rounded p-2 text-slate-400 hover:bg-slate-100 hover:text-black" title="Cerrar">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[65vh] divide-y divide-slate-100 overflow-y-auto">
              {invoices.map((invoice, index) => (
                <div key={getInvoiceDocumentKey(invoice) || index} className="flex items-center gap-3 px-5 py-4">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-black text-slate-900">{invoice.originalFileName || invoice.fileName || `Factura ${index + 1}`}</div>
                    <div className="mt-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">
                      {invoice.contentType || 'Documento'}{invoice.size ? ` · ${Math.ceil(invoice.size / 1024)} KB` : ''}
                    </div>
                  </div>
                  <a href={invoice.url} target="_blank" rel="noreferrer" className="rounded border border-emerald-100 bg-emerald-50 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-emerald-700 hover:bg-emerald-600 hover:text-white">
                    Abrir
                  </a>
                  {canRemove && (
                    <button
                      type="button"
                      disabled={uploadingInvoice}
                      onClick={() => onRemoveInvoice(invoice)}
                      className="rounded border border-red-100 bg-red-50 p-2 text-red-600 hover:bg-red-600 hover:text-white disabled:opacity-40"
                      title="Quitar factura"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      ), document.body)}
    </>
  );
}

export function ExpenseReceiptsCell({
  item,
  canManage,
  uploadingReceipt,
  onUploadReceipt,
  onRemoveReceipt,
  canRemoveReceipt,
}: ExpenseReceiptsCellProps) {
  const receipts = Array.isArray(item.otherReceipts) ? item.otherReceipts : [];

  return (
    <div className="flex flex-wrap items-center justify-center gap-1">
      {receipts.map((receipt: any, receiptIndex: number) => (
        <div key={receipt.id || receipt.path || receipt.url || receiptIndex} className="flex items-center">
          <a
            href={receipt.url}
            target="_blank"
            rel="noreferrer"
            className={cn(
              'flex h-7 items-center justify-center border border-blue-100 bg-blue-50 text-blue-600 transition-all hover:bg-blue-600 hover:text-white',
              canRemoveReceipt(receipt) ? 'w-7 rounded-l' : 'w-7 rounded',
            )}
            title={receipt.originalFileName || receipt.fileName || 'Ver comprobante'}
          >
            <Paperclip className="h-3.5 w-3.5" />
          </a>
          {canRemoveReceipt(receipt) && (
            <button
              type="button"
              disabled={uploadingReceipt}
              onClick={() => onRemoveReceipt(receipt)}
              className="flex h-7 w-6 items-center justify-center rounded-r border-y border-r border-blue-100 bg-white text-slate-300 transition-all hover:border-red-100 hover:text-red-500 disabled:cursor-wait disabled:opacity-50"
              title="Quitar comprobante"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
      {canManage && (
        <label
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded border transition-all',
            uploadingReceipt
              ? 'cursor-wait border-slate-200 bg-slate-100 text-slate-300'
              : 'cursor-pointer border-slate-200 bg-white text-slate-400 hover:border-black hover:text-black',
          )}
          title="Adjuntar otro comprobante"
        >
          <Plus className="h-3.5 w-3.5" />
          <input
            type="file"
            accept={RECEIPT_INPUT_ACCEPT}
            className="hidden"
            disabled={uploadingReceipt}
            onChange={(event) => {
              onUploadReceipt(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>
      )}
    </div>
  );
}

export function InvoiceDropOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center border border-emerald-200 bg-emerald-50/90">
      <div className="flex items-center gap-2 rounded border border-emerald-100 bg-white px-4 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-700 shadow-sm">
        <Paperclip className="h-3.5 w-3.5" />
        Soltar factura PDF/JPG/PNG
      </div>
    </div>
  );
}

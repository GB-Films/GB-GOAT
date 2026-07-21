import React from 'react';
import { FileText, Link as LinkIcon, Paperclip, Plus, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export const INVOICE_INPUT_ACCEPT = 'application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png';
export const RECEIPT_INPUT_ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp';

type ExpenseInvoiceCellProps = {
  item: any;
  canManage: boolean;
  uploadingInvoice: boolean;
  generatingLink: boolean;
  onUploadInvoice: (file?: File | null) => void;
  onRemoveInvoice: () => void;
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
  uploadingInvoice,
  generatingLink,
  onUploadInvoice,
  onRemoveInvoice,
  onCreateInvoiceLink,
}: ExpenseInvoiceCellProps) {
  return (
    <div className="flex items-center justify-center gap-1">
      {item.invoice?.url ? (
        <>
          <a
            href={item.invoice.url}
            target="_blank"
            rel="noreferrer"
            className="flex h-7 w-7 items-center justify-center rounded border border-emerald-100 bg-emerald-50 text-emerald-600 transition-all hover:bg-emerald-600 hover:text-white"
            title={item.invoice.fileName || item.invoice.originalFileName || 'Ver factura'}
          >
            <FileText className="h-3.5 w-3.5" />
          </a>
          {canManage && (
            <button
              type="button"
              disabled={uploadingInvoice}
              onClick={onRemoveInvoice}
              className="flex h-7 w-7 items-center justify-center rounded border border-slate-100 bg-white text-slate-300 transition-all hover:border-red-100 hover:text-red-500 disabled:cursor-wait disabled:opacity-50"
              title="Quitar factura"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </>
      ) : canManage ? (
        <>
          <label
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded border transition-all',
              uploadingInvoice
                ? 'cursor-wait border-slate-200 bg-slate-100 text-slate-300'
                : 'cursor-pointer border-slate-200 bg-white text-slate-400 hover:border-black hover:text-black',
            )}
            title="Adjuntar factura PDF/JPG/PNG"
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
      ) : (
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-300">Sin factura</span>
      )}
    </div>
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

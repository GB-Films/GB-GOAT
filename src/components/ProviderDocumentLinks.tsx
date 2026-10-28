import { handlePortalInvoiceLink } from '../lib/portalInvoiceLink';
import { FileText, Paperclip } from 'lucide-react';
import type { ExpenseInvoiceDocument } from '../lib/invoices';
import { invoicePaymentAppearance } from '../lib/providerPaymentStatus';

export function ProviderDocumentLinks({ documents = [], kind, compact = false, invoicePayment }: {
  documents?: ExpenseInvoiceDocument[];
  kind: 'invoice' | 'other' | 'payment';
  compact?: boolean;
  invoicePayment?: { total: number; paid: number };
}) {
  const label = kind === 'invoice' ? 'Factura' : kind === 'other' ? 'Comprobante' : 'Pago';
  const appearance = kind === 'invoice' && invoicePayment ? invoicePaymentAppearance(invoicePayment.total, invoicePayment.paid) : null;
  const tone = appearance?.className || (kind === 'invoice' ? 'border-emerald-100 bg-emerald-50 text-emerald-700 hover:bg-emerald-600'
    : kind === 'other' ? 'border-blue-100 bg-blue-50 text-blue-700 hover:bg-blue-600'
    : 'border-violet-100 bg-violet-50 text-violet-700 hover:bg-violet-600');
  if (!documents.length) return <span className="block text-center text-xs text-slate-300" aria-label={`Sin ${label.toLowerCase()}`}>—</span>;
  return <div className="flex flex-wrap justify-center gap-1">
    {documents.map((document, index) => {
      const fileName = document.originalFileName || document.fileName || `${label} ${index + 1}`;
      return <a key={document.path || document.url || index} href={document.url || '#'} onClick={e=>handlePortalInvoiceLink(e,document)} target="_blank" rel="noopener noreferrer"
        title={appearance ? `${appearance.label} · ${fileName}` : fileName} aria-label={`${appearance?.label || label}: ${fileName}`}
        className={`inline-flex items-center gap-1 rounded border px-2 ${compact ? 'py-1' : 'py-1.5'} text-[9px] font-bold transition-colors ${appearance ? '' : 'hover:text-white'} ${tone}`}>
        {kind === 'invoice' ? <FileText className="h-3 w-3" /> : <Paperclip className="h-3 w-3" />}
        {label}{documents.length > 1 ? ` ${index + 1}` : ''}
      </a>;
    })}
  </div>;
}

import { PenLine } from 'lucide-react';
import { needsPortalSignature, pendingPortalSignatureCount, portalDocumentCategory } from '../lib/providerPortalUi';
export function ProviderPendingSignatures({ documents, onOpen }: { documents: any[]; onOpen: (category: string) => void }) {
  const total = pendingPortalSignatureCount(documents), receipts = pendingPortalSignatureCount(documents.filter(doc => doc.declarationKind === 'cash_receipt'));
  if (!total) return null;
  return <section aria-label="Firmas pendientes" className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-amber-950 sm:gap-3 sm:p-3">
    <PenLine className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" aria-hidden="true" />
    <div className="min-w-0 flex-1"><p className="font-semibold">Tenés {total} {total === 1 ? 'documento para firmar' : 'documentos para firmar'}</p>
      {receipts > 0 && receipts < total && <p className="text-xs text-amber-800">{receipts} {receipts === 1 ? 'recibo de efectivo' : 'recibos de efectivo'}</p>}</div>
    <button type="button" className="portal-button portal-button-primary" onClick={() => onOpen(receipts ? 'cash-receipts' : portalDocumentCategory(documents.find(needsPortalSignature)!))}>
      {receipts ? `Firmar ${receipts === 1 ? 'recibo' : 'recibos'} (${receipts})` : 'Ir a firmar'}
    </button>
  </section>;
}

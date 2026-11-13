import { PenLine } from 'lucide-react';
import { needsPortalSignature, pendingPortalSignatureCount, portalDocumentCategory } from '../lib/providerPortalUi';
export function ProviderPendingSignatures({ documents, onOpen }: { documents: any[]; onOpen: (category: string) => void }) {
  const total = pendingPortalSignatureCount(documents), receipts = pendingPortalSignatureCount(documents.filter(doc => doc.declarationKind === 'cash_receipt'));
  if (!total) return null;
  return <section role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950">
    <PenLine className="h-5 w-5 shrink-0" aria-hidden="true" />
    <div className="min-w-0 flex-1"><p className="font-semibold">Tenés {total} {total === 1 ? 'documento para firmar' : 'documentos para firmar'}</p>
      <p className="mt-1 text-sm">{receipts ? `${receipts} ${receipts === 1 ? 'recibo de efectivo pendiente' : 'recibos de efectivo pendientes'}. Entrá para revisar y firmar.` : 'Revisalos y firmalos desde Documentos.'}</p></div>
    <button type="button" className="portal-button border-amber-900 bg-amber-900 text-white hover:bg-amber-800" onClick={() => onOpen(receipts ? 'cash-receipts' : portalDocumentCategory(documents.find(needsPortalSignature)!))}>
      {receipts ? `Firmar ${receipts === 1 ? 'recibo' : 'recibos'} (${receipts})` : 'Ir a firmar'}
    </button>
  </section>;
}

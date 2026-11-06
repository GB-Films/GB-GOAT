import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { providerFinanceRequest, type ProjectDocumentScope } from '../lib/providerFinance';
import { expenseLinkedRecordIds, isThirdPartyInvoice, projectInvoiceRelationsKey, sharedInvoiceAction, sharedInvoiceReferences, type InvoiceRecord } from '../lib/sharedExpenseInvoices';
import { SharedProviderFileButton } from './SharedProviderFileButton';
import { ProviderProfileButton } from './ProviderProfileButton';

export const InvoiceContext = createContext<{ records: Map<string, InvoiceRecord>; providers: Map<string, any>; loading: boolean; reload: () => void }>({ records: new Map(), providers: new Map(), loading: false, reload: () => {} });
export function SharedInvoiceRecordsProvider({ scopeKey, projectId, items, providers, children }: { scopeKey: string; projectId: string; items: any[]; providers: any[]; children: ReactNode }) {
  const idsKey = JSON.stringify([...new Set(items.flatMap(expenseLinkedRecordIds))].sort());
  const key = `${scopeKey}/${projectId}/${projectInvoiceRelationsKey(items)}`;
  const [revision, setRevision] = useState(0), [state, setState] = useState<{ key: string; records: InvoiceRecord[]; loading: boolean }>({ key: '', records: [], loading: true });
  useEffect(() => {
    let active = true;
    const ids = JSON.parse(idsKey) as string[];
    setState({ key, records: [], loading: true });
    void (async () => {
      const records: InvoiceRecord[] = [];
      for (let offset = 0; offset < ids.length; offset += 100) {
        const result = await providerFinanceRequest({ action: 'projectDocuments', projectId, recordIds: ids.slice(offset, offset + 100) }) as { records: InvoiceRecord[] };
        records.push(...result.records);
      }
      if (active) setState({ key, records, loading: false });
    })().catch(() => { if (active) setState({ key, records: [], loading: false }); });
    return () => { active = false; };
  }, [key, revision]);
  const value = useMemo(() => ({ records: new Map((state.key === key ? state.records : []).map(row => [row.id, row])), providers: new Map(providers.map(row => [row.id, row])), loading: state.key !== key || state.loading, reload: () => setRevision(value => value + 1) }), [state, key, providers]);
  return <InvoiceContext.Provider value={value}>{children}</InvoiceContext.Provider>;
}
export function SharedExpenseInvoices({ item, scope }: { item: any; scope: ProjectDocumentScope | null }) {
  const { records, providers, loading, reload } = useContext(InvoiceContext);
  const provider = providers.get(item.providerId);
  const references = sharedInvoiceReferences(item);
  return <>{references.map((reference, index) => {
    const record = records.get(reference.id);
    const thirdParty = isThirdPartyInvoice(record || reference, provider?.cuit || provider?.cuitNormalized || provider?.dni_cuit);
    const documentName = record?.number || reference.number || record?.file?.fileName || `Documento ${index + 1}`;
    const label = `${thirdParty ? 'Factura de tercero' : 'Factura'}${references.length > 1 ? ` · ${index + 1}: ${documentName}` : ''}`;
    const className = `max-w-full truncate whitespace-nowrap rounded border px-2 py-1 text-[9px] font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 ${thirdParty ? 'border-amber-400 bg-amber-50 text-amber-950 hover:bg-amber-100 focus-visible:outline-amber-600' : 'border-emerald-100 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 focus-visible:outline-emerald-600'}`;
    const action = sharedInvoiceAction(record, scope);
    return <span key={reference.id} title={documentName} className="inline-flex max-w-full flex-col gap-1">
      {action === 'file' ? <SharedProviderFileButton id={reference.id} scope={scope!} label={label} className={className} />
        : action === 'profile' ? <ProviderProfileButton providerId={item.providerId} className={className}>{label} · {record!.distinctExpenseCount} filas</ProviderProfileButton>
          : <><button type="button" className={className} disabled={loading} onClick={reload}>{loading ? 'Consultando factura…' : label}</button>
            {!loading && <span role="status" className="max-w-48 text-[10px] text-slate-600">{action === 'missing-file' ? 'Esta factura no tiene un archivo disponible.' : action === 'unknown' ? 'No pudimos confirmar las filas de esta factura. Tocá para reintentar.' : 'Factura no disponible o sin acceso. Tocá para reintentar.'}</span>}</>}
    </span>;
  })}</>;
}
